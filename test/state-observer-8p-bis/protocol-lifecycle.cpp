#include <irritator/core.hpp>
#include <algorithm>
#include <array>
#include <iostream>
#include <stdexcept>
#include <string_view>
#include <vector>
namespace {
void require(bool b,const char* s) { if(!b) throw std::runtime_error(s); }
void checked(irt::status s) { require(!s.has_error(),"native engine error"); }
template<class A,class B> void wire(irt::simulation& s,A& a,int ap,B& b,int bp) {
    checked(s.connect(irt::get_model(a),ap,irt::get_model(b),bp));
}
struct event { double t; irt::output_port_id p; irt::message m; bool operator==(const event&) const=default; };
struct fixture {
    irt::simulation s;
    irt::model_id qid,oid;
    fixture(int capacity=128) {
        auto& q=s.alloc<irt::qss3_integrator>(); qid=s.get_id(q); s.parameters[qid].set_integrator(0,std::nextafter(1.,2.));
        auto& d=s.alloc<irt::constant>(); s.parameters[s.get_id(d)].set_constant(1,0); wire(s,d,0,q,0);
        auto& output=s.alloc<irt::counter>(); wire(s,q,0,output,0);
        auto& o=s.alloc<irt::state_observer>(); oid=s.get_id(o); s.parameters[oid].integers[3]=capacity;
        wire(s,q,0,o,0);
        auto& value=s.alloc<irt::counter>(); auto& missing=s.alloc<irt::counter>();
        wire(s,o,0,value,0); wire(s,o,1,missing,0);
        s.limits.set_bound(0,2.5); checked(s.initialize());
        int n=0; while(s.sched.tn()==0) { require(++n<40,"initialization Zeno"); checked(s.run()); }
    }
    irt::state_observer& observer() { return irt::get_dyn<irt::state_observer>(s.models.get(oid)); }
    irt::qss3_integrator& qss() { return irt::get_dyn<irt::qss3_integrator>(s.models.get(qid)); }
};
// Transport fault-injection helper: append an actual bag without invalidating
// any other in-flight bag. This never edits a source's dynamic/physical state.
template<class D> void deliver(irt::simulation& s,D& d,int ip,std::span<const irt::message> messages,double t) {
    require(d.x[ip].size==0,"test tried to overwrite an in-flight bag");
    const auto pos=s.message_buffer.size();
    require(s.message_buffer.reserve(pos+messages.size()),"test allocation");
    for(const auto& m:messages) s.message_buffer.push_back(m);
    d.x[ip].position=static_cast<irt::u32>(pos);
    d.x[ip].size=d.x[ip].capacity=static_cast<irt::u32>(messages.size());
    s.current_time(t); s.sched.update(irt::get_model(d),t);
}
template<class D> void deliver(irt::simulation& s,D& d,int ip,irt::message m,double t) {
    deliver(s,d,ip,std::span<const irt::message>(&m,1),t);
}
void capture(irt::simulation& s,std::vector<event>& result) {
    if(!s.current_time_expired()) for(auto p:s.active_output_ports) result.push_back({s.current_time(),p,s.output_ports.get(p).msg});
}
std::vector<event> drain(irt::simulation& s,double until) {
    std::vector<event> result; int n=0;
    while(s.sched.tn()<=until && !s.current_time_expired()) {
        require(++n<1000,"zero-time Zeno"); checked(s.run()); capture(s,result);
    }
    return result;
}
std::vector<event> finish(irt::simulation& s) {
    std::vector<event> result; int n=0;
    capture(s,result);
    while(!s.current_time_expired()) { require(++n<1000,"replay Zeno"); checked(s.run()); capture(s,result); }
    return result;
}
std::vector<event> on(const std::vector<event>& events,irt::output_port_id p) {
    std::vector<event> r; for(const auto& e:events) if(e.p==p) r.push_back(e); return r;
}
void cancellation() {
    fixture f;
    deliver(f.s,f.observer(),1,irt::message{0,3,7},.25);
    checked(f.s.run()); // read owned, request queued
    checked(f.s.run()); // request output, actual source input in transit
    require(f.qss().x[2].size==1,"no real probe in transit");
    const auto request=irt::get_message(f.s,f.qss().x[2])[0];
    deliver(f.s,f.observer(),2,irt::message{1,0,0},.25);
    auto events=drain(f.s,.25);
    require(on(events,f.observer().y[0]).empty() && on(events,f.observer().y[1]).empty(),"reset failed to cancel outstanding read");
    // Deliberately replay an old response after reset. It must not acquire the
    // repeated business identity's newer request.
    deliver(f.s,f.observer(),3,irt::message{999,request[0],request[1]},.5);
    events=drain(f.s,.5);
    require(on(events,f.observer().y[0]).empty(),"late cancelled response escaped");
    deliver(f.s,f.observer(),1,irt::message{0,3,7},.75);
    events=drain(f.s,.75);
    const auto values=on(events,f.observer().y[0]);
    const auto requests=on(events,f.observer().y[2]);
    require(values.size()==1 && values[0].m==irt::message{.75,3,7},"new read after cancellation wrong");
    require(requests.size()==1 && requests[0].m[0]>request[0],"ticket reused after reset");
    const std::array<irt::message,2> repeated{{{0,3,7},{0,3,7}}};
    deliver(f.s,f.observer(),1,std::span<const irt::message>(repeated),.875);
    events=drain(f.s,.875);
    require(on(events,f.observer().y[0]).size()==2,"repeated business identity collapsed");
    const auto frames=on(events,f.observer().y[2]);
    require(frames.size()==2 && frames[0].m[0]!=frames[1].m[0],"repeated read correlation ambiguous");
    deliver(f.s,f.observer(),3,irt::message{999,frames[1].m[0],frames[1].m[1]},.9);
    events=drain(f.s,.9);
    require(on(events,f.observer().y[0]).empty(),"duplicate response escaped");
    deliver(f.s,f.observer(),2,irt::message{1,0,0},.9375);
    deliver(f.s,f.observer(),1,irt::message{0,3,7},.9375);
    events=drain(f.s,.9375);
    const auto confluent=on(events,f.observer().y[0]);
    require(confluent.size()==1 && confluent[0].m==irt::message{.9375,3,7},"reset/read confluence lost the new occurrence");
    std::cout<<"reset/cancel/late/duplicate/repeated identity/correlation/no-Zeno: PASS\n";
}
void capacity() {
    fixture f(1);
    const std::array<irt::message,2> reads{{{0,3,7},{0,3,7}}};
    deliver(f.s,f.observer(),1,std::span<const irt::message>(reads),.25);
    const auto failure=f.s.run();
    require(failure.has_error() && failure.error().value()==static_cast<int>(irt::simulation_errc::event_capacity_error),"observer FIFO overflow not explicit");
    fixture g;
    std::vector<irt::message> probes;
    for(int i=1;i<=4097;++i) probes.push_back({double(i),double(static_cast<irt::u64>(g.oid)),0});
    deliver(g.s,g.qss(),2,std::span<const irt::message>(probes),.25);
    const auto overflow=g.s.run();
    require(overflow.has_error() && overflow.error().value()==static_cast<int>(irt::simulation_errc::event_capacity_error),"QSS FIFO overflow not explicit");
    std::cout<<"bounded observer and source FIFOs: explicit capacity errors PASS\n";
}
void snapshots() {
    fixture f;
    deliver(f.s,f.observer(),1,irt::message{0,3,7},.25);
    std::array<bool,6> phases{};
    for(int i=0;i<20 && f.s.sched.tn()<=.25;++i) {
        auto& o=f.observer(); auto& q=f.qss();
        auto* os=f.s.event_states.get(f.oid); auto* qs=f.s.event_states.get(f.qid);
        phases[0]=phases[0]||o.x[1].size;
        phases[1]=phases[1]||(os && !os->pending.empty() && os->pending.front().port==2);
        phases[2]=phases[2]||q.x[2].size;
        phases[3]=phases[3]||(qs && !qs->probe_replies.empty());
        phases[4]=phases[4]||o.x[3].size;
        phases[5]=phases[5]||(os && !os->pending.empty() && os->pending.front().port==0);
        irt::simulation_snapshot snap(f.s), copy_snap(snap); irt::simulation control(f.s), assigned; assigned=f.s;
        const auto reference=finish(control);
        require(finish(assigned)==reference,"full simulation assignment changed in-flight protocol");
        finish(f.s); f.s=copy_snap;
        require(finish(f.s)==reference,"snapshot changed in-flight protocol");
        f.s=snap;
        checked(f.s.run());
    }
    require(std::all_of(phases.begin(),phases.end(),[](bool b){return b;}),"not all six in-flight boundaries exercised");
    std::cout<<"all six request/reply boundaries: snapshot/copy/assignment/reload exact PASS\n";
}
void structure() {
    fixture f;
    const auto connections=f.s.output_ports.size();
    checked(irt::validate_structure(f.s)); checked(f.s.initialize());
    require(connections==f.s.output_ports.size(),"materialization duplicated ports");
    irt::simulation bad;
    auto& a=bad.alloc<irt::qss1_integrator>(); auto& b=bad.alloc<irt::qss2_integrator>(); auto& o=bad.alloc<irt::state_observer>();
    wire(bad,a,0,o,0); wire(bad,b,1,o,3);
    require(irt::validate_structure(bad).has_error() && bad.initialize().has_error(),"conflicting pre-existing reply accepted");
    require(bad.event_states.size()==0,"invalid structure initialized atom state");
    irt::simulation unsupported; auto& c=unsupported.alloc<irt::constant>(); auto& u=unsupported.alloc<irt::state_observer>();
    wire(unsupported,c,0,u,0); require(irt::validate_structure(unsupported).has_error(),"non-QSS declaration accepted");
    irt::simulation missing; missing.alloc<irt::state_observer>(); checked(irt::validate_structure(missing)); checked(missing.initialize());
    std::cout<<"static coupling/idempotency/conflict/unsupported/unbound: PASS\n";
}
void clones() {
    fixture f;
    deliver(f.s,f.observer(),1,irt::message{0,3,7},.25);
    checked(f.s.run()); checked(f.s.run());
    require(f.qss().x[2].size==1,"clone fixture has no request in transport");
    auto& qclone_model=f.s.clone(f.s.models.get(f.qid));
    const auto qclone_id=f.s.models.get_id(qclone_model);
    auto& qclone=irt::get_dyn<irt::qss3_integrator>(qclone_model);
    require(qclone.physical_origin==f.qss().physical_origin && qclone.physical_deadline==f.qss().physical_deadline && qclone.sigma==f.qss().sigma,"clone lost physical origin/deadline");
    require(qclone.x[2].size==1 && qclone.x[2].position!=f.qss().x[2].position &&
            irt::get_message(f.s,qclone.x[2])[0]==irt::get_message(f.s,f.qss().x[2])[0],"clone lost/aliased in-flight probe bag");
    f.s.deallocate(qclone_id); // detached clone; the existing clone API does not schedule it
    checked(f.s.run()); // source now owns the computed reply
    require(f.qss().reply_count==1,"no owned source reply for clone test");
    auto& ready_clone=f.s.clone(f.s.models.get(f.qid));
    const auto ready_id=f.s.models.get_id(ready_clone);
    auto* ready=f.s.event_states.get(ready_id); auto* live=f.s.event_states.get(f.qid);
    require(ready && live && ready->probe_replies==live->probe_replies && ready->probe_replies.data()!=live->probe_replies.data(),"source clone lost/aliased response FIFO");
    f.s.deallocate(ready_id);

    auto& clone_model=f.s.clone(f.s.models.get(f.oid));
    const auto clone_id=f.s.models.get_id(clone_model);
    auto& clone=irt::get_dyn<irt::state_observer>(clone_model);
    auto* own=f.s.event_states.get(clone_id);
    auto* original=f.s.event_states.get(f.oid);
    require(own && original && own->observer_reads.size()==1 && own->observer_reads.data()!=original->observer_reads.data(),"clone lost/aliased outstanding observer state");
    require(own->pending.size()==1 && own->pending[0].port==2 && own->pending[0].value[1]==double(static_cast<irt::u64>(clone_id)),"cloned request did not acquire fresh owner correlation");
    require(clone.sigma==0 && clone_model.tn==.25,"cloned reissued request must have an immediate DEVS deadline");
    // Prepare all clone edges before activating the detached clone. Atomic
    // transitions never change graph structure. Reuse an initialized sink.
    irt::model* counter=nullptr;
    for(auto& m:f.s.models) if(m.type==irt::dynamics_type::counter) { counter=&m; break; }
    require(counter!=nullptr,"clone sink fixture");
    checked(f.s.connect(clone_model,0,*counter,0)); checked(f.s.connect(clone_model,1,*counter,0));
    wire(f.s,f.qss(),0,clone,0);
    checked(irt::materialize_observer_couplings(f.s));
    f.s.sched.alloc(clone_model,clone_id,clone_model.tn);
    auto events=drain(f.s,.25);
    const auto a=on(events,f.observer().y[0]), b=on(events,clone.y[0]);
    require(a.size()==1 && b.size()==1 && a[0].m==b[0].m && a[0].m==irt::message{.25,3,7},"reactivated clone did not finish its own in-flight command");
    require(f.s.event_states.get(clone_id)->observer_reads.empty(),"clone correlation leaked");
    std::cout<<"detached clone owns transported probe/physical state; reactivated observer clone reissues with fresh owner: PASS\n";
}
}
int main(int argc,char** argv) {
 try {
    const std::string_view mode=argc>1 ? argv[1] : "all";
    if(mode=="all" || mode=="cancellation") cancellation();
    if(mode=="all" || mode=="capacity") capacity();
    if(mode=="all" || mode=="snapshots") snapshots();
    if(mode=="all" || mode=="structure") structure();
    if(mode=="all" || mode=="clones") clones();
    return 0;
 } catch(const std::exception& e) { std::cerr<<e.what()<<'\n'; return 1; }
}
