#include "fixtures.hpp"
#include <rapidjson/document.h>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <limits>
#include <map>
#include <sstream>

namespace wrapper_test {
namespace {
constexpr double tolerance = 1e-9;
using trajectory = std::vector<std::array<double, 2>>;
using histories = std::map<std::string, trajectory>;
void near(double a, double b, double tol = tolerance) {
    require(std::isfinite(a) && std::abs(a-b) <= tol,
            "Schaefer mismatch: " + std::to_string(a) + " vs " + std::to_string(b));
}
rapidjson::Document reference() {
    std::ifstream file(std::string(SCHAEFER_ROOT) + "/web/model-test/modelhalieutiquetest.json");
    require(file.good(), "Schaefer reference file");
    const std::string input{std::istreambuf_iterator<char>(file), {}};
    rapidjson::Document doc; doc.Parse(input.c_str());
    require(!doc.HasParseError(), "Schaefer reference JSON");
    return doc;
}
// Read the immutable reference rather than maintain a second set of equations.
target_table build_schaefer(fixture& owner, irt::project& project, double effort) {
    const auto doc = reference(); const auto& model = doc["model"];
    require(model["components"].Size()==15 && model["connections"].Size()==18, "Reference topology");
    auto& ids = *owner.access; const auto root = declare_component(ids);
    auto& gen = generic(ids, root); std::map<std::string, irt::child_id> children;
    for (const auto& c : model["components"].GetArray()) {
        const std::string name=c["id"].GetString(), type=c["type"].GetString();
        const auto native = type=="constant" ? irt::dynamics_type::constant :
            type=="qss3_integrator" ? irt::dynamics_type::qss3_integrator :
            type=="qss3_multiplier" ? irt::dynamics_type::qss3_multiplier : irt::dynamics_type::qss3_wsum_2;
        require(type=="constant" || type=="qss3_integrator" || type=="qss3_multiplier" || type=="qss3_wsum_2", "Reference atom type");
        const auto child=add_child(gen,native,name); children.emplace(name,child);
        auto& p=gen.children_parameters[child]; const auto& params=c["parameters"];
        if(type=="constant") p.set_constant(name=="E"?effort:params["value"].GetDouble(),params["offset"].GetDouble());
        if(type=="qss3_integrator") p.set_integrator(params["X"].GetDouble(),params["dQ"].GetDouble());
        if(type=="qss3_wsum_2") p.set_wsum2(params["coeff-0"].GetDouble(),params["coeff-1"].GetDouble());
        if(name=="E") gen.children.get(child).flags.set(irt::child_flags::configurable);
        if(name=="N" || name=="C") gen.children.get(child).flags.set(irt::child_flags::observable);
    }
    for(const auto& edge:model["connections"].GetArray())
        checked(gen.connect(gen.children.get(children.at(edge["from"]["component"].GetString())),
            irt::connection::port{.model=edge["from"]["port"].GetInt()},
            gen.children.get(children.at(edge["to"]["component"].GetString())),
            irt::connection::port{.model=edge["to"]["port"].GetInt()}),"Schaefer connection");
    auto targets=owner.modeling.files.read([&](const auto& files, auto) { return build_project(project,ids,files,root); });
    project.sim.limits.set_bound(0,2); return targets;
}
experiment_spec plan(std::vector<double> efforts={200,260,320}) {
    experiment_spec p; p.factors={{"effort","E",std::move(efforts)}};
    p.selections={{"N","N",irt::criteria_type::max_last},{"C","C",irt::criteria_type::max_last}};
    p.primary="N"; return p;
}
std::unique_ptr<fixture> make_schaefer(std::vector<experiment_spec> plans) {
    auto f=std::make_unique<fixture>(); f->plan=plans[0]; f->occurrence_plans=plans;
    irt::project prospective; auto targets=build_schaefer(*f,prospective,260);
    auto& ids=*f->access; f->prospective=make_descriptor(ids,std::move(prospective),targets,plans[0]);
    const auto root=declare_component(ids); auto& gen=generic(ids,root);
    const auto run=add_child(gen,irt::dynamics_type::constant,"run"); gen.children_parameters[run].set_constant(0,1);
    for(size_t i=0;i<plans.size();++i) {
        const std::string name=i==0?"decision":"right";
        const auto wrapper=add_wrapper(gen,name,f->prospective);
        checked(gen.connect(gen.children.get(run),irt::connection::port{.model=0},gen.children.get(wrapper),irt::connection::port{.model=1}),"Schaefer run");
        for(int port=0;port<3;++port) {
            const auto sink=add_child(gen,irt::dynamics_type::counter,name+"Sink"+std::to_string(port));
            checked(gen.connect(gen.children.get(wrapper),irt::connection::port{.model=port},gen.children.get(sink),irt::connection::port{.model=0}),"Schaefer sink");
        }
    }
    f->parent_targets=f->modeling.files.read([&](const auto& files, auto) { return build_project(f->parent,ids,files,root); });
    for(size_t i=0;i<plans.size();++i) {
        const auto id=f->parent_targets.at(i==0?"decision":"right").model;
        const auto& w=irt::get_dyn<irt::simulation_wrapper>(f->parent.sim.models.get(id));
        require(w.x.size()==3 && w.y.size()==3,"Schaefer 3/3 ports");
        f->ports.emplace_back(w.y.begin(),w.y.end());
        f->bindings.push_back(bind_wrapper(f->parent.sim,id,ids,f->prospective,plans[i]));
    }
    release_unreferenced_resources(f->parent.sim); f->parent.sim.limits.set_bound(0,3); return f;
}
histories flat(double effort) {
    fixture owner; irt::project project; const auto targets=build_schaefer(owner,project,effort);
    auto& sim=project.sim;
    for(const auto* name:{"N","C"}) checked(sim.observe(sim.models.get(targets.at(name).model),.1),"Flat observe");
    checked(sim.srcs.prepare(),"Flat sources"); checked(sim.initialize(),"Flat initialize");
    size_t calls=0;
    while(!sim.current_time_expired()) { require(++calls<10000,"Flat scheduler budget"); checked(sim.run(),"Flat run"); sim.tick_resamplers(); }
    checked(sim.finalize(),"Flat finalize"); sim.tick_resamplers();
    histories result;
    for(const auto* name:{"N","C"}) {
        const auto id=sim.models.get(targets.at(name).model).obs_id;
        auto& obs=*sim.observers.try_to_get(id);
        sim.observers.get<irt::resampler>(id).tick(obs,std::numeric_limits<double>::infinity());
        obs.read_history([&](const auto& history, auto) { for(const auto s:history) result[name].push_back({s.t,s.value}); });
    }
    near(sim.current_time(),2); return result;
}
histories child_history(fixture& f,size_t occurrence,size_t scenario) {
    auto& r=f.parent.sim.sims.get(f.bindings[occurrence].resource); size_t i=0; histories result;
    for(const auto id:r.embedded_sims) if(i++==scenario) {
        const auto& observations=r.embedded_sims.get<irt::embedded_simulation::simulation_observation>(id);
        for(const auto* name:{"N","C"}) {
            const auto* o=observations.get(f.prospective.targets.at(name).model); require(o!=nullptr,"Native child observation");
            result[name]; // Keep an empty history visible immediately after init.
            for(const auto s:o->values) result[name].push_back({s.t,s.value});
        }
    }
    return result;
}
std::array<double,2> analytic(double effort,double time) {
    const double alpha=.35-.001*effort,beta=.35*.003333;
    const double d=1+beta*150*(alpha==0?time:std::expm1(alpha*time)/alpha);
    return {150*std::exp(alpha*time)/d,.001*effort*std::log(d)/beta};
}
void audit(fixture& f,size_t occurrence) {
    auto& r=f.parent.sim.sims.get(f.bindings[occurrence].resource);
    const auto& p=f.occurrence_plans[occurrence]; size_t i=0;
    for(const auto id:r.embedded_sims) {
        const double effort=p.factors[0].values[i]; auto& sim=r.embedded_sims.get<irt::simulation>(id);
        const auto e=f.prospective.targets.at("E").model;
        near(sim.parameters[e].reals[0],effort); near(sim.parameters[e].reals[1],0);
        require(&sim.parameters[e]!=&r.sim.parameters[e],"Private scenario parameter storage");
        near(r.sim.parameters[e].reals[0],260); near(sim.parameters[f.prospective.targets.at("InvK").model].reals[0],.003333,0);
        near(sim.current_time(),2); require(sim.current_time_expired(),"Expired child");
        for(const auto* name:{"N","C"}) near(sim.parameters[f.prospective.targets.at(name).model].reals[1],.01,0);
        const auto actual=child_history(f,occurrence,i++),expected=flat(effort); double max_error=0,max_numeric=0;
        for(const auto* name:{"N","C"}) {
            const auto& a=actual.at(name); const auto& b=expected.at(name);
            require(a.size()==21 && a.size()==b.size(),"Native child/flat sample cardinality");
            near(a.front()[0],0); near(a.back()[0],2);
            for(size_t j=0;j<a.size();++j) {
                near(a[j][0],b[j][0]); near(a[j][1],b[j][1]);
                if(j) require(a[j][0]>a[j-1][0],"Ordered child dates");
                max_error=std::max(max_error,std::abs(a[j][1]-b[j][1]));
                const auto exact=analytic(effort,a[j][0])[std::string(name)=="N"?0:1];
                near(a[j][1],exact,.05); max_numeric=std::max(max_numeric,std::abs(a[j][1]-exact));
            }
        }
        if(effort==260) {
            std::ifstream csv(std::string(SCHAEFER_ROOT)+"/web/model-test/modelhalieutiquetest-points.csv");
            require(csv.good(),"CSV reference"); std::string line; std::getline(csv,line); size_t points=0;
            while(std::getline(csv,line)) {
                if(line.empty() || line=="\r") continue;
                const auto comma=line.find(','),next=line.find(',',comma+1); const auto name=line.substr(1,comma-2);
                const double t=std::stod(line.substr(comma+1,next-comma-1)),value=std::stod(line.substr(next+1));
                bool found=false;
                for(const auto s:actual.at(name)) if(std::abs(s[0]-t)<tolerance) {near(s[1],value); found=true;}
                require(found,"Reference CSV sample date"); ++points;
            }
            require(points==42,"All 42 CSV points checked");
        }
        std::cout<<std::setprecision(17)<<"SCHAEFER occurrence="<<occurrence<<" E="<<effort<<" N="<<actual.at("N").back()[1]
            <<" C="<<actual.at("C").back()[1]<<" samples=42 maxFlatError="<<max_error<<" maxAnalyticError="<<max_numeric<<'\n';
    }
    require(i==p.factors[0].values.size(),"All scenarios inspected");
}
void outputs(fixture& f,double effort,const std::array<double,2>& values) {
    require(f.events.size()==3,"Three native Schaefer outputs");
    for(size_t port=0;port<3;++port) {
        const auto& e=f.events[port]; near(e.time,1); require(e.port==port && e.wrapper==f.bindings[0].wrapper,"Native port/model");
        near(e.value[0],port==2?effort:values[port]); near(e.value[1],0); near(e.value[2],0);
        const auto& sink=irt::get_dyn<irt::counter>(f.parent.sim.models.get(f.parent_targets.at("decisionSink"+std::to_string(port)).model));
        require(sink.event_number==1,"Parent actually receives decision"); near(sink.last_value,e.value[0]);
    }
}
void command(fixture& f,double at,double value,int port) {
    auto& sim=f.parent.sim; require(sim.grow_models_to(static_cast<int>(sim.models.size()+1)),"Command capacity");
    auto& source=irt::get_model(sim.alloc<irt::constant>()); sim.parameters[sim.models.get_id(source)].set_constant(value,at);
    checked(sim.connect(source,0,sim.models.get(f.bindings[0].wrapper),port),"Schaefer command");
}
void trajectories() {
    auto single=plan({260}); single.factors[0].type=irt::factor_type::single;
    auto f=make_schaefer({single}); f->initialize(); f->finish(); audit(*f,0);
    outputs(*f,260,{129.8069509703022,72.34097477635842});
    auto g=make_schaefer({plan()}); g->initialize(); g->finish(); audit(*g,0);
    const auto expected=flat(200); outputs(*g,200,{expected.at("N").back()[1],expected.at("C").back()[1]});
}
void objectives() {
    std::array<std::array<double,2>,3> raw{};
    for(size_t i=0;i<3;++i) {const auto h=flat(200+60*i); raw[i]={h.at("N").back()[1],h.at("C").back()[1]};}
    for(const auto* primary:{"N","C"}) {
        auto p=plan(); p.primary=primary; auto f=make_schaefer({p}); f->initialize(); f->finish();
        const int winner=std::string(primary)=="N"?0:2; outputs(*f,200+60*winner,raw[winner]);
    }
    using T=irt::optimization_type;
    for(const auto norm:{irt::norm_type::min_max,irt::norm_type::z_score}) for(bool reverse:{false,true}) {
        auto p=plan(); p.method=irt::optimization_method::weighted_sum; p.norm=norm;
        p.weights={2,1}; p.types={reverse?T::minimize:T::maximize,T::maximize};
        std::array<std::array<double,2>,3> normalized{};
        for(size_t col=0;col<2;++col) {
            double lo=raw[0][col],hi=lo,mean=0,variance=0;
            for(auto row:raw) {lo=std::min(lo,row[col]);hi=std::max(hi,row[col]);mean+=row[col]/3;}
            for(auto row:raw) variance+=(row[col]-mean)*(row[col]-mean)/3;
            for(size_t row=0;row<3;++row) normalized[row][col]=norm==irt::norm_type::min_max?
                (p.types[col]==T::maximize?(raw[row][col]-lo)/(hi-lo):(hi-raw[row][col])/(hi-lo)):
                (p.types[col]==T::maximize?1:-1)*(raw[row][col]-mean)/std::sqrt(variance);
        }
        size_t winner=0; for(size_t i=1;i<3;++i) if(2*normalized[i][0]+normalized[i][1]>2*normalized[winner][0]+normalized[winner][1]) winner=i;
        auto f=make_schaefer({p}); f->initialize(); f->finish(); outputs(*f,200+60*winner,normalized[winner]);
        auto& objective=f->parent.sim.sims.get(f->bindings[0].resource).objective;
        require(objective.method==p.method,"Native weighted method");
        std::cout<<"SCHAEFER_WEIGHTED norm="<<static_cast<int>(norm)<<" reverse="<<reverse<<" E="<<200+60*winner<<'\n';
    }
    for(bool empty:{false,true}) {
        auto p=plan(); p.method=irt::optimization_method::epsilon_constrained; p.primary="C";
        p.epsilons={empty?1000.:125.,0}; p.operations={irt::operation_type::greater_equal,irt::operation_type::greater_equal};
        auto f=make_schaefer({p}); f->initialize(); f->finish();
        if(empty) require(f->events.empty(),"No feasible Schaefer candidate emits nothing"); else outputs(*f,260,raw[1]);
    }
}
void pair_case() {
    auto f=make_schaefer({plan({200,260}),plan({260,320})});
    require(f->bindings[0].resource!=f->bindings[1].resource && f->parent.sim.sims.size()==2,"Private Schaefer resources");
    command(*f,2,320,2); command(*f,2.1,0,0); command(*f,2.2,0,1);
    f->initialize();
    auto& left=f->parent.sim.sims.get(f->bindings[0].resource); auto& right=f->parent.sim.sims.get(f->bindings[1].resource);
    const auto lid=*left.embedded_sims.begin(),rid=*right.embedded_sims.begin(); const auto e=f->prospective.targets.at("E").model;
    auto& ls=left.embedded_sims.get<irt::simulation>(lid); auto& rs=right.embedded_sims.get<irt::simulation>(rid);
    require(&ls.parameters[e]!=&rs.parameters[e],"Private left/right parameters");
    ls.parameters[e].reals[2]=42; near(rs.parameters[e].reals[2],0); ls.parameters[e].reals[2]=0;
    while(f->events.size()<6) {require(f->calls<30,"Pair first response budget");f->step();}
    audit(*f,0); audit(*f,1); const auto before=child_history(*f,1,0),old_left=child_history(*f,0,0);
    require(left.pending_responses.data()!=right.pending_responses.data(),"Private response storage");
    f->finish(); require(f->events.size()==9,"Only left emits after reset");
    require(before==child_history(*f,1,0),"Right history unchanged after left reset");
    require(old_left!=child_history(*f,0,0),"Left history replaced");
    for(size_t i=0;i<9;++i) {
        const auto& event=f->events[i]; const double effort=i<3?200:i<6?260:320;
        near(event.time,i<6?1:2.2); near(event.value[0],event.port==2?effort:flat(effort).at(event.port==0?"N":"C").back()[1]);
        require(event.wrapper==f->bindings[i>=3 && i<6?1:0].wrapper,"Private event attribution");
    }
    // Whole parent initialization clears histories and restores both configured plans.
    f->initialize(); require(child_history(*f,0,0).at("N").empty() && child_history(*f,1,0).at("N").empty(),"Reset clears observations");
    f->finish(); require(f->events.size()==9 && before==child_history(*f,1,0),"Repeat parent campaign");
    auto g=make_schaefer({plan({260})}); command(*g,1.5,0,1); g->initialize(); g->finish();
    require(g->events.size()==6,"Repeated Schaefer command");
    for(size_t i=0;i<3;++i) {near(g->events[i+3].time,1.5);require(g->events[i].value==g->events[i+3].value,"Repeated terminal decision");}
}
}
void schaefer_case(const std::string& name) {
    if(name=="schaefer-trajectories") trajectories();
    else if(name=="schaefer-objectives") objectives();
    else if(name=="schaefer-pair") pair_case();
    else throw std::runtime_error("Unknown Schaefer case: "+name);
}
}
