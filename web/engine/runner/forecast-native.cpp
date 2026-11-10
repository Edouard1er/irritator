// Native bags, history and private children are inspected before JSON output.
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
        structural_validator(doc,catalog).run(); json_wrappers graph(doc,catalog); graph.build(); auto& sim=graph.parent->project->sim;
        std::vector<json_wrappers::model_event> reference;
        std::vector<irt_web::output_event> wrapper_reference;
        std::cout<<std::setprecision(17);
        for(int pass=0;pass<2;++pass) {
            graph.events.clear(); graph.model_events.clear();
            sim.limits.set_bound(doc["simulation"]["start"].GetDouble(),doc["simulation"]["end"].GetDouble());
            irt_web::checked(sim.srcs.prepare(),"prepare"); irt_web::checked(sim.initialize(),"initialize"); graph.audit_initialized();
            for(const auto& [path,id]:graph.parent->models) if(auto* state=sim.event_states.get(id))
                irt_web::require(state->temporal.empty()&&state->contexts.empty(),"Reset retained temporal state");
            std::map<irt::model_id,irt::u64> campaigns;
            unsigned bag=0;
            while(!sim.current_time_expired()) {
                irt_web::require(++bag<=100000,"Parent run budget"); irt_web::checked(sim.run(),"run");
                if(sim.current_time_expired()) break;
                const auto previous=graph.model_events.size(); graph.collect(bag);
                for(auto i=previous;i<graph.model_events.size();++i) {
                    const auto& e=graph.model_events[i];
                    std::cout<<"MODEL_EVENT "<<pass<<' '<<e.bag<<' '<<e.time<<' '<<e.path<<' '<<e.port<<' '<<e.value[0]<<' '<<e.value[1]<<' '<<e.value[2]<<'\n';
                }
                for(std::size_t i=0;i<graph.bindings.size();++i) {
                    const auto& b=graph.bindings[i]; const auto& o=graph.occurrences[i];
                    const auto& w=irt::get_dyn<irt::simulation_wrapper>(sim.models.get(b.wrapper)); const auto& r=sim.sims.get(b.resource);
                    if(w.last_input_campaign==campaigns[b.wrapper]) continue;
                    const auto campaign=w.last_input_campaign;
                    std::cout<<"RESOURCE "<<pass<<' '<<campaign<<' '<<o.path<<' '<<str((*o.component)["experiment"]["definition"])<<" calls="<<r.campaign_run_calls<<" children="<<r.embedded_sims.size()<<'\n';
                    for(const auto child:r.embedded_sims) {
                        const auto& progress=r.embedded_sims.get<irt::embedded_simulation::execution_result>(child);
                        const auto& sub=r.embedded_sims.get<irt::simulation>(child);
                        irt_web::require(progress.run_calls<=r.execution.max_child_run_calls,"Child budget exceeded");
                        std::cout<<"CHILD "<<pass<<' '<<campaign<<' '<<o.path<<" calls="<<progress.run_calls<<" outcome="<<unsigned(irt::ordinal(progress.outcome))<<" H="<<sub.limits.end()-sub.limits.begin();
                        for(const auto f:r.factors) std::cout<<" factor="<<sub.parameters[r.factors.get<irt::model_id>(f)].reals[0];
                        std::cout<<'\n';
                    }
                    for(const auto& frame:r.dynamic_frames) if(frame.campaign==campaign&&frame.sealed)
                        std::cout<<"PLAN "<<pass<<' '<<o.path<<' '<<campaign<<' '<<frame.plan_id<<' '<<frame.version<<' '<<frame.horizon<<'\n';
                    campaigns[b.wrapper]=campaign;
                }
            }
            for(const auto& [path,id]:graph.parent->models) if(sim.models.get(id).type==irt::dynamics_type::temporal_pair) {
                const auto* state=sim.event_states.get(id);
                for(const auto& r:state->temporal) {
                    irt_web::require(r.status!=1||(r.left_time==r.origin&&r.right_time==r.due&&r.due>r.origin),"Temporal admission violated");
                    std::cout<<"HISTORY "<<pass<<' '<<path<<' '<<r.campaign<<' '<<r.key<<' '<<r.origin<<' '<<r.due<<' '<<r.left<<' '<<r.right<<' '<<r.assumption<<' '<<r.validity<<' '<<r.status<<'\n';
                }
            }
            irt_web::checked(sim.finalize(),"finalize");
            if(pass==0) { reference=graph.model_events; wrapper_reference=graph.events; }
            else {
                irt_web::require(reference.size()==graph.model_events.size()&&wrapper_reference.size()==graph.events.size(),"Reset event count");
                for(unsigned i=0;i<reference.size();++i) {
                    const auto& a=reference[i];const auto& b=graph.model_events[i];
                    irt_web::require(a.path==b.path&&a.port==b.port&&a.bag==b.bag&&a.time==b.time&&a.value==b.value,"Reset model event mismatch");
                }
                for(unsigned i=0;i<wrapper_reference.size();++i) {
                    const auto& a=wrapper_reference[i];const auto& b=graph.events[i];
                    irt_web::require(a.wrapper==b.wrapper&&a.port==b.port&&a.bag==b.bag&&a.time==b.time&&a.value==b.value,"Reset prospective mismatch");
                }
            }
        }
        std::cout<<"NATIVE_FORECAST_RESET_PASS\n";return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 2;}
}
