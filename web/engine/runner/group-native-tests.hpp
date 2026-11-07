void group_native_tests()
{
    const auto send = [](irt::simulation& s, irt::group_aggregate& a, int port, double v, double id, double c, double t=0) {
        auto& source = tag(s, v, id, c, t); checked(wire(s, source, 0, a, port), "group input");
    };
    const auto member = [&](irt::simulation& s, irt::group_aggregate& a, double id, double key, double v, double valid=1, double c=1, double t=0) {
        send(s,a,0,key,id,c,t); send(s,a,1,key,id,c,t); send(s,a,2,v,id,c,t); send(s,a,3,valid,id,c,t);
    };
    const auto messages = [](const auto& events, int port) {
        std::vector<irt::message> out; for(const auto& e:events) if(e.port==port) out.push_back(e.value); return out;
    };
    for (int op=0; op<7; ++op) {
        irt::simulation s; auto& a=add<irt::group_aggregate>(s);
        s.parameters[s.get_id(a)].integers[0]=op;
        member(s,a,7,10,2); member(s,a,2,10,6,1,1,.4); member(s,a,9,20,3);
        send(s,a,4,1,7,1); send(s,a,4,3,2,1); send(s,a,4,2,9,1);
        send(s,a,5,3,3,1,.1); // closure before the delayed fields
        const auto out=execute(s,a); const auto values=messages(out,0);
        const double expected[]={2,6,8,4,2,20,5};
        require(values.size()==2 && values[0]==irt::message{expected[op],2,1}, "group reduction/identity");
        require(messages(out,1)==std::vector<irt::message>{{10,2,1},{20,9,1}}, "action identity changed");
        require(messages(out,6)==std::vector<irt::message>{{2,2,1},{7,2,1},{9,9,1}}, "origin membership lost");
        require(messages(out,2)==std::vector<irt::message>{{2,0,1}}, "group count closure");
        const auto first_result=std::find_if(out.begin(),out.end(),[](const auto& e){return e.port==0;});
        require(first_result!=out.end()&&first_result->time==.4, "end prematurely closed delayed group");
        require(s.event_states.get(s.get_id(a))->groups.empty() && s.event_states.get(s.get_id(a))->barriers.empty(), "group live resource leak");
    }
    for(int policy=0;policy<2;++policy) {
        irt::simulation s; auto& a=add<irt::group_aggregate>(s); s.parameters[s.get_id(a)].integers[1]=policy;
        member(s,a,0,80,10); member(s,a,1,80,0,0); member(s,a,2,150,0,0);
        send(s,a,5,1,3,1,.1);
        const auto out=execute(s,a);
        require(messages(out,0).size()==size_t(policy), "invalid member policy");
        require(messages(out,3)==std::vector<irt::message>{{policy?2.:0.,0,1},{0,2,1}}, "partial status missing");
        require(messages(out,4)==std::vector<irt::message>{{1,0,1},{0,2,1}}, "valid count wrong");
    }
    for(int seal=0;seal<2;++seal) {
        irt::simulation s; auto& a=add<irt::group_aggregate>(s);
        member(s,a,0,80,10); send(s,a,5,1,2,1,.1);
        if(seal) send(s,a,6,0,0,1,.8);
        const auto out=execute(s,a);
        require(messages(out,0).empty(), "missing scenario invented favorable value");
        require(messages(out,2).size()==size_t(seal), "missing scenario silently completed");
    }
    { // Exact numeric keys, never formatted/epsilon-bucketed.
        irt::simulation s; auto& a=add<irt::group_aggregate>(s);
        member(s,a,8,1,7); member(s,a,3,std::nextafter(1.,2.),7); send(s,a,5,2,2,1,.1);
        const auto out=execute(s,a); require(messages(out,0).size()==2, "distinct doubles merged");
        require(messages(out,9)[0][0]!=messages(out,9)[1][0], "group key rounded");
    }
    { // Overlap, close campaign 2 first; a new identity cannot replay 2.
        irt::simulation s; auto& a=add<irt::group_aggregate>(s);
        member(s,a,0,80,10,1,1,1); member(s,a,0,80,20,1,2,.1);
        send(s,a,5,1,1,1,0); send(s,a,5,1,1,2,0);
        const auto out=execute(s,a);
        require(messages(out,0)==std::vector<irt::message>{{20,0,2},{10,0,1}}, "overlap mixed campaigns");
        require(s.event_states.get(s.get_id(a))->closed.size()==1, "closed intervals failed to merge");
    }
    { // Sequential frames reuse one live slot and one closed range.
        irt::simulation s; auto& a=add<irt::group_aggregate>(s);s.parameters[s.get_id(a)].integers[3]=1;
        for(int c=1;c<=25;++c) {member(s,a,0,80,c,1,c,(c-1)*.1);send(s,a,5,1,1,c,(c-1)*.1+.01);}
        const auto out=execute(s,a);require(messages(out,0).size()==25,"sequential groups exhausted capacity");
        const auto* state=s.event_states.get(s.get_id(a));require(state->groups.empty()&&state->barriers.empty()&&state->closed.size()==1,"sequential group resource leak");
    }
    for(const auto test : {0,1,2,3}) {
        irt::simulation s; auto& a=add<irt::group_aggregate>(s);
        member(s,a,0,80,10);
        if(test==0) send(s,a,2,20,0,1,.1); // duplicate field
        if(test==1) { send(s,a,5,1,1,1,.1); send(s,a,0,150,9,1,1); } // replay
        if(test==2) { s.parameters[s.get_id(a)].integers[3]=1; member(s,a,1,150,20); } // capacity
        if(test==3) { send(s,a,0,80,1,1); send(s,a,1,150,1,1); send(s,a,2,20,1,1); send(s,a,3,1,1,1); send(s,a,5,2,2,1,.1); } // conflicting actions
        bool failed=false; try { (void)execute(s,a); } catch(const std::exception&) { failed=true; }
        require(failed, "group protocol/capacity violation accepted");
    }
    for(const auto nonfinite : {std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN(),1.7e308}) {
        irt::simulation s; auto& a=add<irt::group_aggregate>(s); s.parameters[s.get_id(a)].integers[0]=2;
        member(s,a,0,80,13); member(s,a,1,80,13); send(s,a,5,2,2,1,.1);
        auto& sink=add<irt::counter>(s); checked(wire(s,a,7,sink,0),"invalid tap");
        s.limits.set_bound(0,3); checked(s.initialize(),"nonfinite initialize");
        for(auto& m:s.models) if(m.type==irt::dynamics_type::constant) { auto& c=irt::get_dyn<irt::constant>(m); if(c.value==13)c.value=nonfinite; }
        bool invalid=false;
        for(int i=0;i<200 && !s.current_time_expired();++i) { checked(s.run(),"nonfinite run"); for(const auto& e:s.event_states.get(s.get_id(a))->pending) { require(e.port!=0,"nonfinite group aggregate emitted"); invalid=invalid||e.port==7; } }
        require(invalid,"nonfinite group status absent");
    }
    { // Persistent copies/snapshots own tables, reset cancels pending replies.
        irt::simulation s; auto& a=add<irt::group_aggregate>(s); member(s,a,0,80,10);
        s.limits.set_bound(0,3); checked(s.initialize(),"copy initialize");
        int copy_calls=0;
        while(s.event_states.get(s.get_id(a))->groups.empty() || (s.event_states.get(s.get_id(a))->groups[0].mask & 27u)!=27u) {
            require(++copy_calls<100,"copy frame never became ready");checked(s.run(),"copy prepare");
        }
        irt::simulation copy(s); irt::simulation_snapshot snap(s); snap=s;
        const auto id=s.get_id(a); require(copy.event_states.get(id)->groups.size()==1,"copy omitted groups");
        copy.event_states.get(id)->groups[0].value=99; require(s.event_states.get(id)->groups[0].value==10,"copy aliases group runtime");
        copy=snap; require(copy.event_states.get(id)->groups[0].value==10,"snapshot omitted group runtime");
        checked(copy.initialize(),"group reinitialize"); require(copy.event_states.get(id)->groups.empty(),"initialize retained groups");
        copy.deallocate(id); require(!copy.event_states.get(id),"deallocate retained group runtime");
    }
    { // Reset is first in the same bag, followed by a fresh complete frame.
        irt::simulation s; auto& a=add<irt::group_aggregate>(s);
        member(s,a,0,80,99); send(s,a,7,0,0,1,.5); member(s,a,0,150,7,1,1,.5); send(s,a,5,1,1,1,.5);
        const auto out=execute(s,a); require(messages(out,0)==std::vector<irt::message>{{7,0,1}},"group reset confluence");
    }
    { // A causal reset after the first membership emission cancels the FIFO.
        irt::simulation s; auto& a=add<irt::group_aggregate>(s);auto& reset=add<irt::event_operator>(s);
        member(s,a,0,80,10);send(s,a,5,1,1,1,.1);
        checked(wire(s,a,6,reset,0),"reset receipt");checked(wire(s,reset,0,a,7),"reset pending FIFO");
        const auto out=execute(s,a);require(messages(out,0).empty()&&messages(out,1).empty()&&messages(out,2).empty(),"reset retained group action/FIFO");
        require(s.event_states.get(s.get_id(a))->pending.empty()&&s.event_states.get(s.get_id(a))->closed.empty(),"reset retained retired campaigns");
    }
    std::cout << "NATIVE_GROUP_PROTOCOL_PASS\n";
}
