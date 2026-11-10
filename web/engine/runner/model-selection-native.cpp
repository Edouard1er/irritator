// Inspect actual parent bags and private embedded resources before serialization.
#define main json_runner_entrypoint
#include "main.cpp"
#undef main
#include <fstream>
#include <iomanip>

int main(int argc, char** argv) {
    try {
        irt_web::require(argc == 2, "Expected graph document");
        std::ifstream file(argv[1]); const std::string input((std::istreambuf_iterator<char>(file)), {});
        D doc, catalog; doc.Parse(input.c_str()); catalog.Parse(catalog_json); configure_debug_diagnostics();
        structural_validator(doc,catalog).run();
        json_wrappers graph(doc,catalog); graph.build(); auto& sim=graph.parent->project->sim;
        std::vector<irt_web::output_event> reference;
        std::cout<<std::setprecision(17);
        for (int pass=0;pass<2;++pass) {
            graph.events.clear(); sim.limits.set_bound(doc["simulation"]["start"].GetDouble(),doc["simulation"]["end"].GetDouble());
            irt_web::checked(sim.srcs.prepare(),"prepare"); irt_web::checked(sim.initialize(),"initialize"); graph.audit_initialized();
            for(const auto& b:graph.bindings) {
                const auto& r=sim.sims.get(b.resource);
                irt_web::require(r.embedded_sims.empty()&&r.campaign_run_calls==0&&r.dynamic_frames.empty()&&r.pending_responses.empty(),"Reset retained prospective state");
            }
            std::map<irt::model_id,irt::u64> campaigns;
            std::map<irt::u64,int> selected;
            std::set<std::pair<irt::model_id,irt::u64>> sealed;
            std::map<irt::model_id,std::pair<unsigned,irt::u64>> previous;
            unsigned bags=0;
            while(!sim.current_time_expired()) {
                irt_web::require(++bags<=100000,"Parent budget"); irt_web::checked(sim.run(),"run"); graph.collect(bags);
                if(sim.current_time_expired()) break;
                // These ordinary connected outputs are emitted by the real graph.
                for(const auto& [path,id]:graph.parent->models) {
                    if(path.find("/selector/identity")==std::string::npos&&path!="plant/hold"&&path!="plant/effort") continue;
                    const auto& model=sim.models.get(id);
                    irt_web::require(model.type==irt::dynamics_type::event_operator||model.type==irt::dynamics_type::zero_order_hold,"Unexpected trace source type");
                    const auto output=model.type==irt::dynamics_type::event_operator
                      ? irt::get_dyn<irt::event_operator>(model).y[0] : irt::get_dyn<irt::zero_order_hold>(model).y[0];
                    if(std::find(sim.active_output_ports.begin(),sim.active_output_ports.end(),output)!=sim.active_output_ports.end()) {
                        const auto m=sim.output_ports.get(output).msg;
                        std::cout<<"EVENT "<<pass<<' '<<bags<<' '<<sim.current_time()<<' '<<path<<":0 ["<<m[0]<<','<<m[1]<<','<<m[2]<<"]\n";
                        if(path.find("/selector/identity")!=std::string::npos) {
                            irt_web::require(!selected.contains(static_cast<irt::u64>(m[2])),"Multiple selections for one campaign");
                            selected.emplace(static_cast<irt::u64>(m[2]),static_cast<int>(m[0]));
                        }
                    }
                }
                for(std::size_t i=0;i<graph.bindings.size();++i) {
                    const auto& b=graph.bindings[i]; const auto& o=graph.occurrences[i];
                    const auto& w=irt::get_dyn<irt::simulation_wrapper>(sim.models.get(b.wrapper)); const auto& r=sim.sims.get(b.resource);
                    for(const auto& frame:r.dynamic_frames) if(frame.sealed&&sealed.emplace(b.wrapper,static_cast<irt::u64>(frame.campaign)).second) {
                        std::cout<<"PLAN "<<pass<<" campaign="<<frame.campaign<<" model="<<o.path<<" id="<<frame.plan_id<<" version="<<frame.version<<" H="<<frame.horizon<<" scenarios="<<frame.scenarios;
                        for(unsigned f=0;f<o.plan.factors.size();++f) {
                            std::cout<<" domain"<<f<<'=';
                            for(unsigned v=0;v<frame.received[f];++v)std::cout<<(v?",":"")<<frame.domains[f][v];
                        }
                        std::cout<<'\n';
                    }
                    irt::u64 calls=0; for(const auto child:r.embedded_sims) calls+=r.embedded_sims.get<irt::embedded_simulation::execution_result>(child).run_calls;
                    const auto now=std::make_pair(static_cast<unsigned>(r.embedded_sims.size()),calls);
                    const auto old=previous[b.wrapper];
                    if(w.last_input_campaign!=campaigns[b.wrapper]) {
                        const auto c=w.last_input_campaign; irt_web::require(selected.contains(c),"Execution preceded selection");
                        const auto wanted=std::string("forecast/M")+std::to_string(selected.at(c));
                        irt_web::require(o.path==wanted,"Executed unselected prospective");
                        irt_web::require(calls==r.campaign_run_calls&&calls>0,"Native call counters disagree");
                        irt_web::require(calls<=r.execution.max_campaign_run_calls,"Campaign bound");
                        std::cout<<"RESOURCE "<<pass<<" campaign="<<c<<" model="<<o.path<<" definition="<<str((*o.component)["experiment"]["definition"])<<" children="<<now.first<<" calls="<<calls<<'\n';
                        for(const auto child:r.embedded_sims) {
                            const auto& child_sim=r.embedded_sims.get<irt::simulation>(child);
                            const auto& progress=r.embedded_sims.get<irt::embedded_simulation::execution_result>(child);
                            irt_web::require(progress.run_calls<=r.execution.max_child_run_calls,"Child bound");
                            std::cout<<"CHILD "<<pass<<" campaign="<<c<<" model="<<o.path<<" atoms="<<child_sim.models.size()<<" calls="<<progress.run_calls<<" status="<<static_cast<unsigned>(irt::ordinal(progress.outcome))<<" H="<<child_sim.limits.end()-child_sim.limits.begin();
                            for(const auto f:r.factors) std::cout<<" factor="<<child_sim.parameters[r.factors.get<irt::model_id>(f)].reals[0];
                            std::cout<<'\n';
                        }
                        campaigns[b.wrapper]=c;
                    } else irt_web::require(now==old,"Inactive branch allocated or advanced children");
                    previous[b.wrapper]=now;
                }
            }
            irt_web::checked(sim.finalize(),"finalize");
            for(const auto& [c,choice]:selected) for(std::size_t i=0;i<graph.bindings.size();++i) {
                const auto& o=graph.occurrences[i]; if(o.path=="forecast/M"+std::to_string(choice)) continue;
                const auto& b=graph.bindings[i];
                irt_web::require(std::none_of(graph.events.begin(),graph.events.end(),[&](const auto& e){return e.wrapper==b.wrapper&&e.value[2]==double(c);}),"Unselected branch emitted campaign results");
                std::cout<<"NON_SELECTED "<<pass<<" campaign="<<c<<" model="<<o.path<<" new_children=0 run_calls=0 events=0\n";
            }
            if(pass==0) reference=graph.events;
            else {
                irt_web::require(reference.size()==graph.events.size(),"Reset event count");
                for(unsigned i=0;i<reference.size();++i) {
                    const auto& a=reference[i]; const auto& b=graph.events[i];
                    irt_web::require(a.wrapper==b.wrapper&&a.time==b.time&&a.port==b.port&&a.bag==b.bag&&a.value==b.value,"Reset event mismatch");
                }
            }
        }
        std::cout<<"NATIVE_MODEL_SELECTION_RESET_PASS\n";return 0;
    } catch(const std::exception& e) {std::cerr<<e.what()<<'\n';return 2;}
}
