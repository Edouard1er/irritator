// Inspect the native snapshots, then execute independent flat native copies.
#define main json_runner_entrypoint
#include "main.cpp"
#undef main
#include <fstream>
#include <iomanip>

int main(int argc, char** argv) {
    try {
        irt_web::require(argc==2,"Expected 8O document");
        std::ifstream file(argv[1]);const std::string input((std::istreambuf_iterator<char>(file)),{});
        D doc,catalog;doc.Parse(input.c_str());catalog.Parse(catalog_json);configure_debug_diagnostics();
        auto& e=doc["model"]["components"][1]["experiment"];
        V observation(rapidjson::kObjectType);auto& a=doc.GetAllocator();
        observation.AddMember("target","C",a).AddMember("samplingInterval",.1,a);e["trajectoryObservations"].PushBack(observation,a);
        json_wrappers graph(doc,catalog);graph.build();auto& sim=graph.parent->project->sim;
        const auto& descriptor=graph.descriptors.begin()->second;
        const auto& source_project=graph.parent->access->sim_components.get(descriptor.simulation).pj;
        for(int invalid=0;invalid<4;++invalid) {
            auto spec=descriptor.spec;
            if(invalid==0) spec.trajectory_targets.push_back(spec.trajectory_targets.front());
            if(invalid==1) spec.trajectory_targets={"missing"};
            if(invalid==2) spec.mode=irt::simulation_wrapper::run_type::bag;
            if(invalid==3) spec.max_trajectory_points=20001;
            bool rejected=false;
            try { (void)irt_web::validate_experiment(source_project,descriptor.targets,spec); }
            catch(const std::exception&) { rejected=true; }
            irt_web::require(rejected,"Native invalid trajectory configuration accepted");
        }
        std::cout<<std::setprecision(17);
        for(int pass=0;pass<2;++pass) {
            graph.events.clear();graph.model_events.clear();graph.trajectories.clear();graph.trajectory_points=0;
            sim.limits.set_bound(0,3);irt_web::checked(sim.srcs.prepare(),"prepare");irt_web::checked(sim.initialize(),"initialize");
            unsigned bag=0;
            while(!sim.current_time_expired()) {
                irt_web::require(++bag<100000,"parent budget");irt_web::checked(sim.run(),"parent run");graph.collect(bag);
            }
            irt_web::checked(sim.finalize(),"finalize");
            irt_web::require(graph.trajectories.size()==6 && graph.trajectory_points==2412,"six native scenarios, twelve series");
            const auto& resource=sim.sims.get(graph.bindings[0].resource);
            for(const auto id:resource.embedded_sims)
                irt_web::require(resource.embedded_sims.get<irt::simulation>(id).observers.size()==2,"shared criteria/trajectory observers");
            for(const auto& [index,snapshot]:graph.trajectories) {
                irt::simulation flat=resource.sim;
                std::size_t j=0;
                for(const auto factor:resource.factors) flat.parameters[resource.factors.get<irt::model_id>(factor)].reals[0]=snapshot.factors[j++];
                for(const auto& series:snapshot.observations) irt_web::checked(flat.observe(flat.models.get(series.model),.1),"flat observe");
                irt_web::checked(flat.srcs.prepare(),"flat prepare");irt_web::checked(flat.initialize(),"flat initialize");
                unsigned calls=0;
                while(!flat.current_time_expired()) {irt_web::require(++calls<100000,"flat budget");irt_web::checked(flat.run(),"flat run");flat.tick_resamplers();}
                irt_web::checked(flat.finalize(),"flat finalize");
                for(auto& obs:flat.observers) flat.observers.get<irt::resampler>(flat.observers.get_id(obs)).tick(obs,std::numeric_limits<double>::infinity());
                for(const auto& series:snapshot.observations) {
                    bool equal=true;double maximum=0;
                    flat.observers.try_to_get(flat.models.get(series.model).obs_id)->read_history([&](const auto& history,const auto) noexcept {
                        equal=history.size()==series.samples.size() && history.size()==201;
                        if(equal) for(int k=0;k<history.size();++k) {
                            equal=equal && std::abs(history[k].t-series.samples[k].t)<=1e-9;
                            maximum=std::max(maximum,std::abs(history[k].value-series.samples[k].value));
                        }
                    });
                    irt_web::require(equal && maximum<=1e-9,"native flat/child mismatch");
                    std::cout<<"NATIVE_8O "<<pass<<' '<<snapshot.campaign<<' '<<snapshot.scenario<<' '<<irt::ordinal(series.model)<<" points="<<series.samples.size()<<" maxError="<<maximum<<'\n';
                }
            }
        }
        // Every exposed catalogue type really supports native observation.
        irt::simulation observability;
        for(const auto& [name,type]:registry) {
            const auto& model=type.make(observability);
            irt_web::require(irt::dispatch(model,[]<class T>(const T&) {return irt::has_observation_function<T>;}),"Catalogue observability: "+name);
        }
        std::cout<<"NATIVE_8O_RESET_FLAT_PASS\n";return 0;
    } catch(const std::exception& error) {std::cerr<<error.what()<<'\n';return 1;}
}
