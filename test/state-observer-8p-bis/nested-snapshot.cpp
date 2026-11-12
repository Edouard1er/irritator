#include <irritator/core.hpp>
template<class A,class B> irt::status wire(irt::simulation& s,A& a,int ap,B& b,int bp) { return s.connect(irt::get_model(a),ap,irt::get_model(b),bp); }
#include <iostream>
#include <stdexcept>
void check(bool b) { if(!b) throw std::runtime_error("nested in-flight state was not restored"); }
void checked(irt::status s) { check(!s.has_error()); }
int main() {
 try {
    irt::simulation parent;
    check(parent.sims.reserve(1));
    auto& resource=parent.sims.alloc(); const auto rid=parent.sims.get_id(resource);
    auto& child=resource.sim;
    auto& source=child.alloc<irt::constant>(); child.parameters[child.get_id(source)].set_constant(3,1);
    auto& sink=child.alloc<irt::counter>(); const auto id=child.get_id(sink);
    checked(wire(child,source,0,sink,0)); child.limits.set_bound(0,3); checked(child.initialize());
    checked(child.run()); check(sink.x[0].size==1);
    irt::simulation_snapshot snapshot(parent);
    checked(child.run()); check(sink.x[0].size==0);
    parent=snapshot;
    auto& restored=parent.sims.get(rid).sim;
    auto& counter=irt::get_dyn<irt::counter>(restored.models.get(id));
    check(counter.x[0].size==1 && irt::get_message(restored,counter.x[0])[0]==irt::message{3,0,0});
    checked(restored.run()); check(counter.event_number==1);
    std::cout<<"nested simulation pending transport restored: PASS\n"; return 0;
 } catch(const std::exception& e) { std::cerr<<e.what()<<'\n'; return 1; }
}
