// The production v3 compiler and native DEVS bags, before HTTP/resampling.
#define main json_runner_entrypoint
#include "main.cpp"
#undef main
#include <fstream>
#include <iomanip>

int main(int argc,char** argv) {
    try {
        irt_web::require(argc==2,"Expected uncertainty fixture");
        std::ifstream file(argv[1]); const std::string input((std::istreambuf_iterator<char>(file)),{});
        D doc,catalog; doc.Parse(input.c_str());catalog.Parse(catalog_json);configure_debug_diagnostics();
        json_wrappers graph(doc,catalog);graph.build();auto& s=graph.parent->project->sim;const auto& ids=graph.parent->models;
        irt_web::require(s.grow_models_to(int(s.models.size()+48)),"trace capacity");
        for(const auto& name:{"minCH","maxCH","minN","count"}) {
            auto& a=irt::get_dyn<irt::group_aggregate>(s.models.get(ids.at(std::string("observer/decide/")+name)));
            for(int p=0;p<10;++p) { auto& sink=irt::get_model(s.alloc<irt::counter>());irt_web::checked(s.connect(irt::get_model(a),p,sink,0),"group trace tap"); }
        }
        auto& choice=s.models.get(ids.at("observer/decide/choose/priority"));
        for(int p:{4,5}) {auto& sink=irt::get_model(s.alloc<irt::counter>());irt_web::checked(s.connect(choice,p,sink,0),"choice trace tap");}
        s.limits.set_bound(0,5);irt_web::checked(s.srcs.prepare(),"prepare");irt_web::checked(s.initialize(),"initialize");graph.audit_initialized();
        auto& wrapper=irt::get_dyn<irt::simulation_wrapper>(s.models.get(graph.bindings[0].wrapper));
        auto& resource=s.sims.get(graph.bindings[0].resource);const auto& desc=graph.descriptors.at(graph.occurrences[0].component);
        using Row=std::array<double,3>;
        std::map<int,std::array<double,2>> observed;
        std::map<int,unsigned> initialized,read,run,applied,initSent;
        std::map<std::string,std::vector<Row>> results;
        std::vector<std::array<double,2>> actions;
        const auto near=[](double a,double b,double tol=1e-10){irt_web::require(std::isfinite(a)&&std::abs(a-b)<=tol,"Native grouped value differs: "+std::to_string(a)+" vs "+std::to_string(b));};
        std::cout<<std::setprecision(17);unsigned bag=0;
        while(!s.current_time_expired()) {
            irt_web::require(++bag<15000,"native grouped livelock");irt_web::checked(s.run(),"run");graph.collect(bag);
            if(s.current_time_expired())break;
            const auto t=s.current_time();
            for(const auto& [path,id]:ids) if(path.starts_with("observer/")||path.starts_with("plant/observe")||path=="plant/effort"||path=="forecast") {
                irt::dispatch(s.models.get(id),[&]<class T>(const T& d){
                    if constexpr(irt::has_output_port<T>) for(int p=0;p<std::ssize(d.y);++p) {
                        if(std::find(s.active_output_ports.begin(),s.active_output_ports.end(),d.y[p])==s.active_output_ports.end())continue;
                        const auto m=s.output_ports.get(d.y[p]).msg;
                        std::cout<<"EVENT "<<bag<<' '<<t<<' '<<path<<':'<<p<<" ["<<m[0]<<','<<m[1]<<','<<m[2]<<"]\n";
                        results[path+":"+std::to_string(p)].push_back({m[0],m[1],m[2]});
                        if((path=="plant/observeN"||path=="plant/observeC")&&p==0) {
                            const int field=path=="plant/observeN"?0:1;observed[int(m[2])][field]=m[0];read[int(m[2])]=bag;
                            const auto& src=s.models.get(ids.at(field?"plant/C":"plant/N"));near(m[0],irt::get_dyn<irt::qss3_integrator>(src).observation(t,t-src.tl).value);
                        }
                        if(path=="observer/synchronize/initValue"&&p==0)initSent[int(m[2])]=bag;
                        if(path=="plant/effort") {near(m[1],0);near(m[2],0);actions.push_back({t,m[0]});if(t)applied[t==1?1:2]=bag;}
                    }
                });
            }
            if(std::find(s.immediate_models.begin(),s.immediate_models.end(),graph.bindings[0].wrapper)!=s.immediate_models.end()&&wrapper.state==irt::simulation_wrapper::run_state::initialized&&!resource.input_frames.empty()) {
                const auto c=int(resource.input_frames.front().campaign);
                if(initSent[c]&&bag>initSent[c]&&!initialized.contains(c)) {
                    initialized[c]=bag;size_t scenario=0;
                    irt_web::require(resource.embedded_sims.size()==6,"six native children required");
                    for(const auto child:resource.embedded_sims) {
                        const auto& cs=resource.embedded_sims.get<irt::simulation>(child);
                        for(int f=0;f<2;++f) { const auto id=desc.targets.at(f?"C":"N").model;near(cs.parameters[id].reals[0],observed[c][f]);near(cs.parameters[id].reals[1],.01);near(irt::get_dyn<irt::qss3_integrator>(cs.models.get(id)).X,observed[c][f]); }
                        const auto E=cs.parameters[desc.targets.at("E").model].reals[0],q=cs.parameters[desc.targets.at("q").model].reals[0];
                        near(E,std::array<double,3>{80,150,260}[scenario%3]);near(q,scenario<3?.0008:.001);
                        std::cout<<"CHILD_INIT "<<bag<<' '<<t<<' '<<c<<' '<<scenario++<<' '<<observed[c][0]<<' '<<observed[c][1]<<' '<<E<<' '<<q<<'\n';
                    }
                }
            }
            if(wrapper.last_input_campaign&&!run.contains(int(wrapper.last_input_campaign)))run[int(wrapper.last_input_campaign)]=bag;
        }
        irt_web::checked(s.finalize(),"finalize");
        irt_web::require(actions==std::vector<std::array<double,2>>{{0,260},{1,150},{3,150}},"Applied efforts differ");
        irt_web::require(initialized.size()==2&&observed.size()==2,"missing native campaigns");
        near(irt::get_dyn<irt::constant>(s.models.get(ids.at("plant/q"))).value,.001);
        for(int c:{1,2}) {
            irt_web::require(read[c]<initialized[c]&&initialized[c]<run[c]&&run[c]<applied[c],"native causal order changed");
            for(int gid=0;gid<3;++gid) {
                double minCH=std::numeric_limits<double>::infinity(),maxCH=-minCH,minN=minCH;int n=0;
                for(const auto& e:graph.events) if(e.value[2]==c&&(e.value[1]==gid||e.value[1]==gid+3)) {
                    if(e.port==12){minCH=std::min(minCH,e.value[0]);maxCH=std::max(maxCH,e.value[0]);++n;}
                    if(e.port==11)minN=std::min(minN,e.value[0]);
                }
                irt_web::require(n==2,"missing raw scenarios");
                for(const auto& [name,value]:std::array<std::pair<const char*,double>,4>{{{"minCH",minCH},{"maxCH",maxCH},{"minN",minN},{"count",2}}}) {
                    const auto& out=results.at(std::string("observer/decide/")+name+":0");
                    const auto found=std::find_if(out.begin(),out.end(),[&](auto row){return row[1]==gid&&row[2]==c;});
                    irt_web::require(found!=out.end(),"missing group result");near((*found)[0],value);
                }
                std::cout<<"GROUP "<<c<<' '<<gid<<' '<<std::array<int,3>{80,150,260}[gid]<<' '<<minCH<<' '<<maxCH<<' '<<minN<<" 2\n";
            }
        }
        for(const auto& [name,expected]:std::array<std::pair<const char*,double>,2>{{{"plant/N",155.007095478631},{"plant/C",126.058376506886}}}) {
            const auto& m=s.models.get(ids.at(name));const auto value=irt::get_dyn<irt::qss3_integrator>(m).observation(5,5-m.tl).value;near(value,expected);std::cout<<"FINAL "<<name<<' '<<value<<'\n';
        }
        std::cout<<"NATIVE_GROUPED_FEEDBACK_PASS bags="<<bag<<'\n';return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
