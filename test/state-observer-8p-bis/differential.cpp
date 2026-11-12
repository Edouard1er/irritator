// Uses only the historical public interface so the identical driver also
// compiles against the frozen HEAD headers/archive for exact byte comparison.
#include <irritator/core.hpp>
template<class A,class B> irt::status wire(irt::simulation& s,A& a,int ap,B& b,int bp) { return s.connect(irt::get_model(a),ap,irt::get_model(b),bp); }
#include <algorithm>
#include <array>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <vector>
namespace {
void require(bool b,const char* m) { if(!b) throw std::runtime_error(m); }
void checked(irt::status s) { require(!s.has_error(),"native error"); }
struct emission { double t; irt::message value; bool operator==(const emission&) const=default; };
struct result { std::vector<emission> physical, samples; };
template<int Order> result run(bool instrumented,bool polynomial,bool reverse,int reset_case) {
    irt::simulation s;
    irt::constant* first=nullptr;
    if(reverse) first=&s.alloc<irt::constant>();
    auto& q=s.alloc<irt::abstract_integrator<Order>>();
    const double d=std::nextafter(1.,2.);
    s.parameters[s.get_id(q)].set_integrator(0,d);
    auto& derivative=first ? *first : s.alloc<irt::constant>();
    s.parameters[s.get_id(derivative)].set_constant(1,0);
    auto& sink=s.alloc<irt::counter>(); checked(wire(s,q,0,sink,0));
    if(polynomial) {
        auto& tag=s.alloc<irt::event_tag>();
        s.parameters[s.get_id(tag)].reals[0]=1; s.parameters[s.get_id(tag)].reals[1]=1;
        checked(wire(s,derivative,0,tag,0)); checked(wire(s,tag,0,q,0));
    } else checked(wire(s,derivative,0,q,0));
    // Reset and derivative share one actual routed bag; reset wins historically.
    if(reset_case) {
        const auto reset_time=reset_case==2 ? d : .75;
        auto& reset=s.alloc<irt::constant>(); s.parameters[s.get_id(reset)].set_constant(3,reset_time);
        auto& dot=s.alloc<irt::constant>(); s.parameters[s.get_id(dot)].set_constant(2,reset_time);
        checked(wire(s,reset,0,q,1)); checked(wire(s,dot,0,q,0));
        auto& restart=s.alloc<irt::constant>(); s.parameters[s.get_id(restart)].set_constant(-1,1.25);
        checked(wire(s,restart,0,q,0));
    }
    std::array<irt::state_observer*,2> observers{};
    if(instrumented) for(auto& observer:observers) {
        observer=&s.alloc<irt::state_observer>(); checked(wire(s,q,0,*observer,0));
        auto& sink_value=s.alloc<irt::counter>(); checked(wire(s,*observer,0,sink_value,0));
        auto& sink_missing=s.alloc<irt::counter>(); checked(wire(s,*observer,1,sink_missing,0));
    }
    const std::array<double,9> dates{0,std::ldexp(1.,-53),.25,.75,1.,d,1.25,1.5,2.};
    for(auto date:dates) {
        auto& clock=s.alloc<irt::constant>(); s.parameters[s.get_id(clock)].set_constant(0,date);
        auto& tag=s.alloc<irt::event_tag>();
        s.parameters[s.get_id(tag)].reals[0]=3; s.parameters[s.get_id(tag)].reals[1]=7;
        checked(wire(s,clock,0,tag,0));
        if(instrumented) for(auto* observer:observers) checked(wire(s,tag,0,*observer,1));
        else { auto& unused=s.alloc<irt::counter>(); checked(wire(s,tag,0,unused,0)); }
    }
    s.limits.set_bound(0,2.25); checked(s.initialize()); result r;
    std::array<std::vector<emission>,2> responses;
    int steps=0;
    while(!s.current_time_expired()) {
        require(++steps<2000,"zero-time Zeno"); checked(s.run());
        if(s.current_time_expired()) break;
        for(auto p:s.active_output_ports) {
            if(p==q.y[0]) r.physical.push_back({s.current_time(),s.output_ports.get(p).msg});
            if(instrumented) for(int i=0;i<2;++i) {
                if(p==observers[i]->y[0]) responses[i].push_back({s.current_time(),s.output_ports.get(p).msg});
                require(p!=observers[i]->y[1],"unexpected missing");
            }
        }
        if(s.sched.tn()>s.current_time() && std::find(dates.begin(),dates.end(),s.current_time())!=dates.end())
            r.samples.push_back({s.current_time(),{q.observation(s.current_time(),s.current_time()-irt::get_model(q).tl).value,3,7}});
    }
    if(instrumented) for(const auto& replies:responses) require(replies==r.samples,"X(t), repeated identity, two-owner correlation or dates differ");
    checked(s.finalize()); return r;
}
template<int Order> void check() {
    for(bool poly:{false,true}) for(bool reverse:{false,true}) for(int reset_case:{0,1,2}) {
        auto baseline=run<Order>(false,poly,reverse,reset_case);
        auto observed=run<Order>(true,poly,reverse,reset_case);
        require(baseline.physical==observed.physical,"y0 dates/values/multiplicity differ");
        require(baseline.samples==observed.samples,"observation physical origin differs");
        if(!poly && reset_case==0) require(std::any_of(observed.physical.begin(),observed.physical.end(),[](const auto& e){return e.t==std::nextafter(1.,2.);}),"real observer probes displaced the nextafter deadline");
        std::cout<<"QSS"<<Order<<" polynomial="<<poly<<" reversed="<<reverse<<" reset="<<reset_case<<'\n';
        for(const auto& v:baseline.physical) std::cout<<"y0 "<<v.t<<' '<<v.value[0]<<' '<<v.value[1]<<' '<<v.value[2]<<'\n';
        for(const auto& v:baseline.samples) std::cout<<"X "<<v.t<<' '<<v.value[0]<<'\n';
    }
}
}
int main() {
 try {
    std::cout<<std::hexfloat;
    check<1>(); check<2>(); check<3>(); return 0;
 } catch(const std::exception& e) { std::cerr<<e.what()<<'\n'; return 1; }
}
