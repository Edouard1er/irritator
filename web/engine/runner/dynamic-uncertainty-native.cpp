// Test instrumentation of production compilation, actual children and DEVS bags.
#define main json_runner_entrypoint
#include "main.cpp"
#undef main
#include <chrono>
#include <fstream>
#include <iomanip>

int main(int argc, char** argv) {
    try {
        irt_web::require(argc == 2, "Expected 8I graph");
        std::ifstream file(argv[1]); const std::string input((std::istreambuf_iterator<char>(file)), {});
        D doc, catalog; doc.Parse(input.c_str()); catalog.Parse(catalog_json); configure_debug_diagnostics();
        // The diagnostic sink is an ordinary bounded graph atom, charged by the
        // production compiler before initialization. No engine limit is raised.
        auto& alloc = doc.GetAllocator();
        for (auto& d : doc["model"]["definitions"].GetArray()) if (std::string(d["id"].GetString()) == "AggregateActions") {
            D atom; atom.Parse("{\"id\":\"trace\",\"type\":\"qss1_sum_2\",\"parameters\":{}}");
            V a; a.CopyFrom(atom, alloc); d["components"].PushBack(a, alloc);
            for (const auto* name : {"minCH", "maxCH", "minN", "count"}) for (int p = 0; p < 10; ++p) {
                D wire; wire.Parse(("{\"from\":{\"component\":\""+std::string(name)+"\",\"port\":"+std::to_string(p)+"},\"to\":{\"component\":\"trace\",\"port\":0}}").c_str());
                V e; e.CopyFrom(wire, alloc); d["connections"].PushBack(e, alloc);
            }
        }
        json_wrappers graph(doc, catalog); graph.build();
        auto& s = graph.parent->project->sim; const auto& ids = graph.parent->models;
        s.limits.set_bound(0, 5); irt_web::checked(s.srcs.prepare(), "prepare"); irt_web::checked(s.initialize(), "initialize"); graph.audit_initialized();
        auto& w = irt::get_dyn<irt::simulation_wrapper>(s.models.get(graph.bindings[0].wrapper));
        auto& resource = s.sims.get(graph.bindings[0].resource);
        const auto& desc = graph.descriptors.at(graph.occurrences[0].component);
        using Row = std::array<double, 3>;
        std::map<std::string, std::vector<Row>> results;
        std::map<int, std::array<double, 2>> observed;
        std::map<int, unsigned> read, ready, executed, applied;
        std::map<int, std::vector<double>> efforts, contexts;
        std::map<int, int> counts;
        std::vector<std::array<double, 2>> actions;
        const auto near = [](double a, double b, double tol=1e-9) { irt_web::require(std::isfinite(a) && std::abs(a-b)<=tol, "8I native mismatch: "+std::to_string(a)+" vs "+std::to_string(b)); };
        const auto output = [&](const std::string& path, int p, int campaign, int identity) {
            const auto& rows = results[path+":"+std::to_string(p)];
            const auto it = std::find_if(rows.rbegin(), rows.rend(), [&](const auto& r) { return r[1]==identity && r[2]==campaign; });
            irt_web::require(it != rows.rend(), "Missing native output "+path+":"+std::to_string(p)); return (*it)[0];
        };
        unsigned bag=0; std::cout<<std::setprecision(17);
        while (!s.current_time_expired()) {
            irt_web::require(++bag<=100000, "Parent budget exceeded");
            const auto start=std::chrono::steady_clock::now();
            irt_web::checked(s.run(), "run");
            const auto milliseconds=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count();
            graph.collect(bag); if(s.current_time_expired()) break;
            const auto t=s.current_time();
            for(const auto& [path,id]:ids) if(path.starts_with("observer/")||path.starts_with("plant/observe")||path=="plant/effort")
                irt::dispatch(s.models.get(id), [&]<class T>(const T& d) {
                    if constexpr(irt::has_output_port<T>) for(int p=0;p<std::ssize(d.y);++p) {
                        if(std::find(s.active_output_ports.begin(),s.active_output_ports.end(),d.y[p])==s.active_output_ports.end()) continue;
                        const auto m=s.output_ports.get(d.y[p]).msg;
                        results[path+":"+std::to_string(p)].push_back({m[0],m[1],m[2]});
                        std::cout<<"EVENT "<<bag<<' '<<t<<' '<<path<<':'<<p<<" ["<<m[0]<<','<<m[1]<<','<<m[2]<<"]\n";
                        if(p==0&&(path=="plant/observeN"||path=="plant/observeC")) {
                            const int f=path=="plant/observeC"; observed[int(m[2])][f]=m[0]; read[int(m[2])]=bag;
                            const auto& src=s.models.get(ids.at(f?"plant/C":"plant/N"));
                            near(m[0],irt::get_dyn<irt::qss3_integrator>(src).observation(t,t-src.tl).value);
                        }
                        if(path=="plant/effort"&&p==0) {near(m[1],0);near(m[2],0);actions.push_back({t,m[0]});if(t)applied[t==1?1:2]=bag;std::cout<<"ACTION "<<t<<' '<<m[0]<<'\n';}
                    }
                });
            for(const auto& e:graph.events) if(e.bag==bag&&e.port==14) {
                const int c=int(e.value[2]); ready[c]=bag; counts[c]=int(e.value[0]);
                const auto it=std::find_if(resource.dynamic_frames.begin(),resource.dynamic_frames.end(),[&](const auto& f){return f.campaign==c;});
                irt_web::require(it!=resource.dynamic_frames.end()&&it->sealed,"Validated frame missing");
                near(it->plan_id,c);near(it->version,1);near(it->horizon,c==1?20:10);
                for(int f:{2,3}) for(unsigned i=0;i<it->cardinalities[f];++i) (f==2?efforts[c]:contexts[c]).push_back(it->domains[f][i]);
                irt_web::require(counts[c]==efforts[c].size()*contexts[c].size(),"Product mismatch");
                std::cout<<"PLAN "<<c<<" id="<<it->plan_id<<" version="<<it->version<<" H="<<it->horizon<<" E_count="<<efforts[c].size()<<" q_count="<<contexts[c].size()<<" children="<<counts[c]<<'\n';
            }
            const int c=int(w.last_input_campaign);
            if(c&&!executed.contains(c)) {
                executed[c]=bag; irt_web::require(resource.embedded_sims.size()==counts[c],"Actual child count mismatch");
                unsigned scenario=0, replay_calls=0, points=0, models=0;
                for(const auto child:resource.embedded_sims) {
                    const auto& cs=resource.embedded_sims.get<irt::simulation>(child);
                    near(cs.limits.begin(),0);near(cs.limits.end(),c==1?20:10);
                    std::cout<<"CHILD "<<c<<' '<<scenario<<" H="<<cs.limits.end();
                    for(unsigned f=0;f<4;++f) {
                        const auto target=desc.targets.at(desc.spec.factors[f].target).model;
                        const auto v=cs.parameters[target].reals[0];
                        near(v,f<2?observed[c][f]:f==2?efforts[c][scenario%efforts[c].size()]:contexts[c][scenario/efforts[c].size()]);
                        if(f<2)near(cs.parameters[target].reals[1],.01);
                        std::cout<<' '<<desc.spec.factors[f].id<<'='<<v;
                    }
                    std::cout<<'\n';++scenario;models+=cs.models.size();
                    const auto& obs=resource.embedded_sims.get<irt::embedded_simulation::simulation_observation>(child);
                    for(const auto& entry:obs.data)points+=entry.value.values.size();
                    // Deterministic replay of each ACTUAL parameterized child
                    // measures internal run calls without changing production.
                    auto replay=cs;irt_web::checked(replay.srcs.prepare(),"replay prepare");irt_web::checked(replay.initialize(),"replay initialize");
                    while(!replay.current_time_expired()) {++replay_calls;irt_web::checked(replay.run(),"replay run");}
                    irt_web::checked(replay.finalize(),"replay finalize");
                    for(const auto* name:{"N","C"}) {
                        const auto id=desc.targets.at(name).model;const auto& a=cs.models.get(id);const auto& b=replay.models.get(id);const auto H=cs.limits.end();
                        near(irt::get_dyn<irt::qss3_integrator>(a).observation(H,H-a.tl).value,irt::get_dyn<irt::qss3_integrator>(b).observation(H,H-b.tl).value);
                    }
                }
                std::cout<<"RESOURCES "<<c<<" children="<<counts[c]<<" child_models="<<models<<" criterion_points="<<points<<" replay_internal_calls="<<replay_calls<<" wrapper_run_ms="<<milliseconds<<'\n';
            }
        }
        irt_web::checked(s.finalize(),"finalize");
        irt_web::require(counts[1]==6&&(counts[2]==4||counts[2]==2),"Expected 6 then 4/2 scenarios");
        near(irt::get_dyn<irt::constant>(s.models.get(ids.at("plant/q"))).value,.001);
        irt_web::require(actions==std::vector<std::array<double,2>>{{0,260},{1,150},{3,efforts[2].size()==1?80.:150.}},"Applied action values/dates differ");
        for(int c:{1,2}) {
            irt_web::require(read[c]<ready[c]&&ready[c]<executed[c]&&executed[c]<applied[c],"Causal order violated");
            for(unsigned g=0;g<efforts[c].size();++g) {
                double lo=std::numeric_limits<double>::infinity(),hi=-lo,n=lo;
                std::vector<int> members;
                for(const auto& e:graph.events) if(e.value[2]==c&&int(e.value[1])%efforts[c].size()==g) {
                    if(e.port==12){lo=std::min(lo,e.value[0]-observed[c][1]);hi=std::max(hi,e.value[0]-observed[c][1]);members.push_back(int(e.value[1]));}
                    if(e.port==11)n=std::min(n,e.value[0]);
                }
                irt_web::require(members.size()==contexts[c].size(),"Context set mismatch");
                for(const auto& [name,value]:std::array<std::pair<const char*,double>,4>{{{"minCH",lo},{"maxCH",hi},{"minN",n},{"count",double(members.size())}}}) {
                    const auto path=std::string("observer/decide/groups/")+name;
                    near(output(path,0,c,g),value);near(output(path,1,c,g),efforts[c][g]);near(output(path,3,c,g),1);
                    near(output(path,4,c,g),members.size());near(output(path,5,c,g),members.size());near(output(path,8,c,0),1);
                    near(output(path,2,c,0),efforts[c].size());
                    std::vector<int> actual;
                    for(const auto& r:results[path+":6"])if(r[1]==g&&r[2]==c)actual.push_back(int(r[0]));
                    irt_web::require(actual==members,"Group membership mismatch");
                }
                std::cout<<"GROUP "<<c<<' '<<g<<" E="<<efforts[c][g]<<" minDeltaC="<<lo<<" maxDeltaC="<<hi<<" Nrob="<<n<<" valid="<<members.size()<<" status=1 members=";
                for(const auto sid:members)std::cout<<sid<<',';std::cout<<'\n';
            }
            near(output("observer/decide/evaluate/choose/primary",3,c,0),c==1?0:1);
            near(output("observer/decide/evaluate/choose/secondary",3,c,0),1);
        }
        for(const auto* path:{"plant/N","plant/C"}) {const auto& m=s.models.get(ids.at(path));std::cout<<"FINAL "<<path<<' '<<irt::get_dyn<irt::qss3_integrator>(m).observation(5,5-m.tl).value<<'\n';}
        irt_web::checked(s.srcs.prepare(),"reset prepare");irt_web::checked(s.initialize(),"reset initialize");graph.audit_initialized();
        irt_web::require(w.last_input_campaign==0&&resource.dynamic_frames.empty()&&resource.pending_responses.empty(),"Reset retained state");
        unsigned reset_bags=0;while(!s.current_time_expired()){irt_web::require(++reset_bags<=100000,"Reset budget");irt_web::checked(s.run(),"reset run");}
        irt_web::checked(s.finalize(),"reset finalize");irt_web::require(w.last_input_campaign==2&&resource.embedded_sims.size()==counts[2],"Reset did not replay plans");
        std::cout<<"RESET_PASS bags="<<reset_bags<<"\nNATIVE_DYNAMIC_UNCERTAINTY_PASS bags="<<bag<<'\n';return 0;
    } catch(const std::exception& e) {std::cerr<<e.what()<<'\n';return 1;}
}
