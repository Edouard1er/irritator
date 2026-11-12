#include <irritator/core.hpp>
template<class A,class B> irt::status wire(irt::simulation& s,A& a,int ap,B& b,int bp) { return s.connect(irt::get_model(a),ap,irt::get_model(b),bp); }
#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <vector>
namespace {
void require(bool b, const char* s) { if (!b) throw std::runtime_error(s); }
void checked(irt::status s) { require(!s.has_error(), "engine error"); }
struct output { double t; irt::message m; bool operator==(const output&) const = default; };
template<class A, class B> bool same(const A& a, const B& b) {
    return a.size() == b.size() && std::equal(a.begin(), a.end(), b.begin());
}
void add(irt::simulation& s, irt::state_observer& o, double t, double k, double c) {
    auto& source=s.alloc<irt::constant>(); s.parameters[s.get_id(source)].set_constant(0,t);
    auto& tag=s.alloc<irt::event_tag>(); s.parameters[s.get_id(tag)].reals[0]=k; s.parameters[s.get_id(tag)].reals[1]=c;
    checked(wire(s,source,0,tag,0)); checked(wire(s,tag,0,o,1));
}
std::vector<output> finish(irt::simulation& s, irt::model_id id) {
    std::vector<output> result;
    auto& o=irt::get_dyn<irt::state_observer>(s.models.get(id));
    for(int i=0;!s.current_time_expired();++i) {
        require(i<100,"Zeno"); checked(s.run());
        if(s.current_time_expired()) break;
        for(auto p:s.active_output_ports) if(p==o.y[1]) result.push_back({s.current_time(),s.output_ports.get(p).msg});
    }
    return result;
}
}
int main() {
 try {
    irt::simulation s; auto& o=s.alloc<irt::state_observer>(); const auto id=s.get_id(o);
    auto& sink=s.alloc<irt::counter>(); checked(wire(s,o,1,sink,0));
    add(s,o,1,3,7); add(s,o,2,9,11); s.limits.set_bound(0,3); checked(s.initialize());
    int n=0; while(o.x[1].size==0) { require(++n<30,"no read"); checked(s.run()); }
    irt::simulation control(s); irt::simulation_snapshot a(s), b(a), reused;
    reused=s;
    const auto active=s.active_output_ports;
    const auto immediate=s.immediate_models;
    const auto observers=s.immediate_observers;
    const auto last=s.last_time();
    require(a.message_buffer.data()!=s.message_buffer.data() && b.message_buffer.data()!=a.message_buffer.data(),"snapshot aliases transport");
    const auto expected=finish(control,id);
    require(expected==std::vector<output>{{1,{0,3,7}},{2,{0,9,11}}},"positive control wrong");
    finish(s,id);
    for(const auto* snap:{&a,&b,&reused}) {
        s=*snap;
        // Every public end-of-run boundary is observable by the caller.
        std::cout<<"boundary active="<<same(s.active_output_ports,active)
                 <<" immediate="<<same(s.immediate_models,immediate)
                 <<" observers="<<same(s.immediate_observers,observers)
                 <<" last="<<(s.last_time()==last)<<" copy-last="<<(irt::simulation(control).last_time()==control.last_time())<<'\n';
        require(same(s.active_output_ports,active),"restored active output boundary differs");
        require(same(s.immediate_models,immediate),"restored immediate model boundary differs");
        require(same(s.immediate_observers,observers),"restored observer boundary differs");
        require(s.last_time()==last,"restored last valid time differs");
        require(finish(s,id)==expected,"snapshot replay changed identity/date");
    }
    for(int i=0;i<2;++i) { checked(s.initialize()); require(finish(s,id)==expected,"reinitialization changed trace"); }
    std::cout<<"snapshot ownership/copy/reuse/reload/reinitialize/run-boundaries: PASS\n";
    return 0;
 } catch(const std::exception& e) { std::cerr<<e.what()<<'\n'; return 1; }
}
