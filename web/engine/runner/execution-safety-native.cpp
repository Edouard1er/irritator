// Native bags and resource inspection; no JSON result serializer or JS engine.
#define main json_runner_entrypoint
#include "main.cpp"
#undef main
#include <chrono>
#include <fstream>
#include <iomanip>

int main(int argc, char** argv) {
    try {
        irt_web::require(argc == 2, "Expected graph file");
        std::ifstream file(argv[1]); const std::string input((std::istreambuf_iterator<char>(file)), {});
        D doc, catalog; doc.Parse(input.c_str()); catalog.Parse(catalog_json); configure_debug_diagnostics();
        // Connect ordinary trace sinks before compilation, charged to the same
        // model and connection budgets. All group status ports become observable.
        for (auto& d : doc["model"]["definitions"].GetArray()) if (str(d["id"]) == "AggregateActions") {
            auto& a=doc.GetAllocator(); D sink; sink.Parse("{\"id\":\"trace\",\"type\":\"qss1_sum_2\",\"parameters\":{}}");
            d["components"].PushBack(V(sink,a),a);
            for (const auto* id : {"minCH","maxCH","minN","count"}) for (int p=0;p<10;++p) {
                D e; e.Parse(("{\"from\":{\"component\":\""+std::string(id)+"\",\"port\":"+std::to_string(p)+"},\"to\":{\"component\":\"trace\",\"port\":0}}").c_str());
                d["connections"].PushBack(V(e,a),a);
            }
        }
        json_wrappers graph(doc,catalog);graph.build();auto& s=graph.parent->project->sim;
        std::cout<<"NATIVE_STORAGE result_bytes="<<sizeof(irt::embedded_simulation::execution_result)
                 <<" options_bytes="<<sizeof(irt::embedded_simulation::execution_options)<<" resources="<<s.sims.size()<<" models="<<s.models.size()<<'\n';
        std::vector<irt_web::output_event> reference;
        // Synthetic structural corruption, separate from scientific failures:
        // reject a missing status port before executing any child, then restore
        // the manifest and explicitly reinitialize the same native graph.
        for(const auto& binding:graph.bindings) {
            auto& wrapper=irt::get_dyn<irt::simulation_wrapper>(s.models.get(binding.wrapper));
            if(!wrapper.execution_status)continue;
            const auto port=wrapper.y.back();wrapper.y.resize(wrapper.y.size()-1);
            irt_web::require(s.initialize().has_error(),"Malformed execution port manifest accepted");
            wrapper.y.emplace_back(port);std::cout<<"NATIVE_PORT_MANIFEST_REJECTED\n";
        }
        std::cout<<std::setprecision(17);
        for(int pass=0;pass<2;++pass) {
            graph.events.clear(); s.limits.set_bound(doc["simulation"]["start"].GetDouble(),doc["simulation"]["end"].GetDouble());
            irt_web::checked(s.srcs.prepare(),"prepare");irt_web::checked(s.initialize(),"initialize");graph.audit_initialized();
            for(const auto& binding:graph.bindings) {
                const auto& r=s.sims.get(binding.resource);
                irt_web::require(r.pending_responses.empty()&&r.input_frames.empty()&&r.dynamic_frames.empty()&&r.campaign_run_calls==0,"Reset retained campaign state");
            }
            unsigned bags=0; double native_ms=0, collection_ms=0, execution_ms=0, emission_ms=0; std::map<irt::model_id,irt::u64> campaigns;
            while(!s.current_time_expired()) {
                irt_web::require(++bags<=100000,"Parent budget");
                auto start=std::chrono::steady_clock::now();irt_web::checked(s.run(),"run");
                const auto run_ms=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count();
                native_ms+=run_ms;
                const auto previous_events=graph.events.size();
                start=std::chrono::steady_clock::now();graph.collect(bags);
                collection_ms+=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count();
                if(graph.events.size()!=previous_events) emission_ms+=run_ms;
                if(s.current_time_expired())break;
                for(const auto& [path,id]:graph.parent->models) irt::dispatch(s.models.get(id),[&]<class T>(const T& dyn){
                    if constexpr(irt::has_output_port<T>) for(int p=0;p<std::ssize(dyn.y);++p)
                        if(std::find(s.active_output_ports.begin(),s.active_output_ports.end(),dyn.y[p])!=s.active_output_ports.end()) {
                            const auto m=s.output_ports.get(dyn.y[p]).msg;
                            std::cout<<"EVENT "<<pass<<' '<<bags<<' '<<s.current_time()<<' '<<path<<':'<<p<<" ["<<m[0]<<','<<m[1]<<','<<m[2]<<"]\n";
                        }
                });
                for(const auto& binding:graph.bindings) {
                    const auto& w=irt::get_dyn<irt::simulation_wrapper>(s.models.get(binding.wrapper));
                    const auto c=w.dynamic_plan||w.required_inputs?w.last_input_campaign:w.campaign;
                    if(c<=campaigns[binding.wrapper])continue;campaigns[binding.wrapper]=c;
                    execution_ms+=run_ms;
                    const auto& r=s.sims.get(binding.resource);irt::u64 calls=0;unsigned valid=0,invalid=0,canceled=0,points=0;
                    for(const auto child:r.embedded_sims) {
                        const auto& progress=r.embedded_sims.get<irt::embedded_simulation::execution_result>(child);
                        calls+=progress.run_calls;
                        irt_web::require(!r.execution.max_child_run_calls||progress.run_calls<=r.execution.max_child_run_calls,"Child bound");
                        if(progress.outcome==irt::embedded_simulation::scenario_outcome::success)++valid;
                        else if(progress.outcome==irt::embedded_simulation::scenario_outcome::canceled) {++canceled;irt_web::require(progress.run_calls==0,"Canceled child ran");}
                        else ++invalid;
                        const auto& obs=r.embedded_sims.get<irt::embedded_simulation::simulation_observation>(child);
                        for(const auto& e:obs.data)points+=e.value.values.size();
                    }
                    irt_web::require(calls==r.campaign_run_calls,"Campaign call sum");
                    irt_web::require(!r.execution.max_campaign_run_calls||calls<=r.execution.max_campaign_run_calls,"Campaign bound");
                    std::cout<<"RESOURCE "<<pass<<' '<<c<<" calls="<<calls<<" valid="<<valid<<" invalid="<<invalid<<" canceled="<<canceled<<" points="<<points<<" wrapper_ms="<<run_ms<<'\n';
                }
            }
            irt_web::checked(s.finalize(),"finalize");
            if(pass==0) reference=graph.events;
            else {irt_web::require(reference.size()==graph.events.size(),"Reset event size");for(unsigned i=0;i<reference.size();++i) {
                const auto& a=reference[i];const auto& b=graph.events[i];
                irt_web::require(a.wrapper==b.wrapper&&a.time==b.time&&a.port==b.port&&a.bag==b.bag&&a.value==b.value,"Reset event mismatch");
            }}
            std::cout<<"NATIVE_TIME pass="<<pass<<" run_ms="<<native_ms<<" execution_bags_ms="<<execution_ms<<" emission_bags_ms="<<emission_ms<<" collect_ms="<<collection_ms<<" bags="<<bags<<" events="<<graph.events.size()<<'\n';
        }
        std::cout<<"NATIVE_EXECUTION_SAFETY_RESET_PASS\n";return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 2;}
}
