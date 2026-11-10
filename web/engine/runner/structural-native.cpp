#define main embedded_runner_main
#include "main.cpp"
#undef main
#include <fstream>
void ensure(bool condition,const char* message) { if(!condition)throw std::runtime_error(message); }
template<class T> void monadic(T&& start) {
    unsigned calls=0;
    auto r=std::forward<T>(start).and_then([&]() -> irt::status { ++calls;return irt::make_error(irt::simulation_errc::event_protocol_error); })
      .and_then([&]() -> irt::status { ++calls;return irt::success(); });
    ensure(r.has_error() && r.error().value()==70 && calls==1,"and_then must propagate first failure and skip later preparation");
}
int main(int argc,char** argv) {
#ifdef _MSC_VER
    (void)_set_error_mode(_OUT_TO_STDERR);
    _set_abort_behavior(0,_WRITE_ABORT_MSG | _CALL_REPORTFAULT);
#endif
    try {
        configure_debug_diagnostics();
        irt::status s;const irt::status c;
        monadic(s);monadic(c);monadic(std::move(s));monadic(std::move(c));
        unsigned calls=0;auto failed=irt::status(irt::make_error(irt::simulation_errc::event_protocol_error));
        auto skipped=failed.and_then([&](){++calls;});ensure(skipped.has_error()&&calls==0,"failed status skips void callback");
        auto value=irt::success().and_then([](){return irt::expected<int>(42);});ensure(value.has_value()&&value.value()==42,"and_then preserves returned value");
        irt::simulation flat;auto& source=flat.alloc<irt::constant>();auto& observer=flat.alloc<irt::state_observer>();
        ensure(flat.connect(irt::get_model(source),-1,irt::get_model(observer),0).has_error(),"negative source port rejected");
        ensure(flat.connect(irt::get_model(source),999,irt::get_model(observer),0).has_error(),"large source port rejected");
        ensure(flat.connect(irt::get_model(source),0,irt::get_model(observer),-1).has_error(),"negative target port rejected");
        ensure(flat.connect(irt::get_model(source),0,irt::get_model(observer),0).has_value(),"source edge established before validation");
        ensure(irt::validate_structure(flat).has_error()&&flat.initialize().has_error(),"flat incompatible binding rejected natively");
        ensure(flat.event_states.size()==0,"preflight precedes model initialization");
        irt::simulation absent;absent.alloc<irt::state_observer>();
        ensure(irt::validate_structure(absent).has_value()&&absent.initialize().has_value(),"unbound observer retains the native missing contract");
        irt::simulation ambiguous;auto& a=ambiguous.alloc<irt::qss1_integrator>();auto& b=ambiguous.alloc<irt::qss3_integrator>();auto& sample=ambiguous.alloc<irt::state_observer>();
        ensure(ambiguous.connect(irt::get_model(a),0,irt::get_model(sample),0).has_value()&&ambiguous.connect(irt::get_model(b),0,irt::get_model(sample),0).has_value(),"ambiguous graph assembled without initialization");
        ensure(irt::validate_structure(ambiguous).has_error()&&ambiguous.initialize().has_error()&&ambiguous.event_states.size()==0,"ambiguous native binding rejected before initialization");
        if(argc==2) {
            std::ifstream file(argv[1]);std::string input((std::istreambuf_iterator<char>(file)),{});D doc;doc.Parse(input.c_str());D catalog;catalog.Parse(catalog_json);
            // Deliberately bypass the JSON preflight to prove native protection.
            json_wrappers graph(doc,catalog);graph.build();auto& sim=graph.parent->project->sim;
            auto result=sim.initialize();ensure(result.has_error()&&result.error().value()==72,"invalid prospective rejected natively");
            for(const auto& resource:sim.sims)ensure(resource.embedded_sims.size()==0,"no scenario copied from invalid prototype");
            auto& prototype=sim.sims.get(graph.bindings.front().resource).sim;
            irt::model_id source_id{},observer_id{};
            for(const auto& mdl:prototype.models) {
                if(mdl.type==irt::dynamics_type::constant)source_id=prototype.models.get_id(mdl);
                if(mdl.type==irt::dynamics_type::state_observer)observer_id=prototype.models.get_id(mdl);
            }
            prototype.disconnect(prototype.models.get(source_id),0,prototype.models.get(observer_id),0);
            prototype.parameters[observer_id].integers[3]=0; // force an ordinary child initialization failure
            ensure(irt::validate_structure(sim).has_value(),"source repaired before probing propagation");
            const auto initialization=sim.initialize();
            ensure(initialization.has_error()&&initialization.error().value()==static_cast<int>(irt::simulation_errc::simulation_wrapper_embedded_simulation_initialization_error),"real child initialization error must propagate through wrapper.and_then");
            prototype.parameters[observer_id].integers[3]=128;
            for(int reset=0;reset<2;++reset) {
                ensure(sim.initialize().has_value(),"corrected native graph initializes after a rejected preparation");
                int calls=0;while(!sim.current_time_expired()) {ensure(++calls<10000,"bounded native parent");ensure(sim.run().has_value(),"corrected native graph runs");}
                ensure(sim.finalize().has_value(),"corrected native graph finalizes");
            }
        }
        std::cout<<"NATIVE_STRUCTURAL_PASS propagation=4 ports=3 prototype-before-copy reset-safe\n";return 0;
    } catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
