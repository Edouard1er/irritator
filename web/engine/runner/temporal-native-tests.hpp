void temporal_native_tests()
{
    const auto feed=[](irt::simulation& s,auto& d,int port,double v,double key=0,double campaign=1,double date=0) {
        auto& input=tag(s,v,key,campaign,date);checked(wire(s,input,0,d,port),"temporal input");
    };
    for(int encoded=0;encoded<3;++encoded) {
        irt::simulation s;auto& d=add<irt::event_operator>(s);
        // Archived r3=0 remains transparent; explicit overrides use ID+1,
        // including the largest exactly representable protocol identifier.
        s.parameters[s.get_id(d)].reals[3]=encoded==0?0:encoded==1?6:9007199254740992.0;
        feed(s,d,0,4,7);const auto out=execute(s,d);
        require(out.size()==1&&out[0].value[1]==(encoded==0?7:encoded==1?5:9007199254740991.0),"numeric identity compatibility");
    }
    for(int variant=0;variant<13;++variant) {
        irt::simulation s;auto& d=add<irt::temporal_pair>(s);
        const auto id=s.get_id(d);
        if(variant!=3) feed(s,d,2,1);
        if(variant!=4&&variant!=8) feed(s,d,0,.6,0,1,variant==5||variant==12?.5:0);
        if(variant==8) {
            // Produce a non-finite value through an actual QSS operation.
            // A constant with infinity would correctly fail initialize first.
            auto& base=constant(s,2);auto& power=add<irt::qss3_power>(s);
            s.parameters[s.get_id(power)].set_power(2000);
            auto& identity=add<irt::event_tag>(s);s.parameters[s.get_id(identity)].reals[1]=1;
            checked(wire(s,base,0,power,0),"overflow base");checked(wire(s,power,0,identity,0),"overflow tag");checked(wire(s,identity,0,d,0),"overflow pair");
        }
        if(variant!=2&&variant!=5&&variant!=8&&variant!=9) feed(s,d,1,1,0,1,variant==12?0:variant==6?.5:1);
        feed(s,d,3,variant==7?2:0);feed(s,d,9,1);
        feed(s,d,5,variant==9?3:1);
        feed(s,d,4,0);
        if(variant==10) feed(s,d,4,2,0,0,.5);
        if(variant==11) feed(s,d,4,2,0,0,1); // right endpoint belongs to next window
        feed(s,d,7,0,0,1,2);
        const auto out=execute(s,d);
        const int expected=variant<=1||variant==11?1:variant==2?4:variant==3||variant==5||variant==6||variant==12?5:variant==4?3:variant==8||variant==9?2:6;
        const auto* state=s.event_states.get(id);
        require(state&&state->temporal.size()==1&&state->temporal[0].status==expected,"temporal status");
        require(std::count_if(out.begin(),out.end(),[&](auto& e){return e.port==2&&e.value[0]==expected;})==1,"one terminal status");
        require(std::count_if(out.begin(),out.end(),[](auto& e){return e.port==0||e.port==1;})==(expected==1?2:0),"inadmissible pair emitted numerical values");
        if(expected==1) for(const auto& e:out) if(e.port<2) require(e.time==1,"early empirical verification");
        irt::simulation_snapshot snapshot(s);irt::simulation copy(s);copy=snapshot;
        require(copy.event_states.get(id)->temporal[0].status==expected,"snapshot lost temporal history");
    }
    { // Multiple deadlines, overlapping campaigns, exact same variable/date.
        irt::simulation s;auto& d=add<irt::temporal_pair>(s);
        for(int c=1;c<=3;++c) {
            feed(s,d,2,c==3?2:1,0,c);feed(s,d,0,c,0,c);feed(s,d,1,c,0,c,c==3?2:1);
            feed(s,d,9,c==3?2:1,0,c);feed(s,d,3,0,0,c);feed(s,d,5,1,0,c);
        }
        feed(s,d,2,1,1,1);feed(s,d,9,1,1,1);feed(s,d,0,2,1,1);feed(s,d,1,2,1,1,1);feed(s,d,3,0,1,1);feed(s,d,5,1,1,1);
        feed(s,d,4,0);const auto out=execute(s,d);
        require(std::count_if(out.begin(),out.end(),[](auto& e){return e.port==2&&e.value[0]==1;})==4,"overlapping identities lost");
    }
    { // Cancellation creates a tombstone, with no numerical pair.
        irt::simulation s;auto& d=add<irt::temporal_pair>(s);feed(s,d,2,1);feed(s,d,0,.6);feed(s,d,3,0);feed(s,d,5,1);feed(s,d,6,0,0,1,.5);
        const auto out=execute(s,d);require(std::count_if(out.begin(),out.end(),[](auto& e){return e.port==2&&e.value[0]==7;})==1,"cancel status");
    }
    { // Calendar holds arbitrary dates and preserves IDs through zero-time FIFO.
        irt::simulation s;auto& d=add<irt::event_calendar>(s);
        feed(s,d,0,2,0,1);feed(s,d,0,1,1,2);feed(s,d,0,1,2,2);
        const auto out=execute(s,d);int count=0;
        for(const auto& e:out)if(e.port==0){++count;require(e.time==e.value[0],"calendar emitted at wrong time");}
        require(count==3,"calendar lost concurrent requests");
    }
    for(const bool calendar:{false,true}) { // Capacity failure is a native error.
        irt::simulation s;
        const auto check=[&](auto& d){s.parameters[s.get_id(d)].integers[3]=1;feed(s,d,calendar?0:2,1,0,1);feed(s,d,calendar?0:2,2,0,2);
            bool failed=false;try{execute(s,d);}catch(const std::exception&){failed=true;}require(failed,"capacity was silently increased");};
        if(calendar)check(add<irt::event_calendar>(s));else check(add<irt::temporal_pair>(s));
    }
    { // Replay of a completed pair is rejected, never scored twice.
        irt::simulation s;auto& d=add<irt::temporal_pair>(s);feed(s,d,2,1);feed(s,d,9,1);feed(s,d,0,1);feed(s,d,1,1,0,1,1);feed(s,d,1,1,0,1,2);feed(s,d,3,0);feed(s,d,4,0);feed(s,d,5,1);
        bool failed=false;try{execute(s,d);}catch(const std::exception&){failed=true;}require(failed,"duplicate observation accepted");
    }
    { // Explicit reset cancels old dates and permits the same local identity.
        irt::simulation s;auto& d=add<irt::event_calendar>(s);feed(s,d,0,1);feed(s,d,2,0,0,0,.5);feed(s,d,0,2,0,1,1);
        const auto out=execute(s,d);require(std::count_if(out.begin(),out.end(),[](auto& e){return e.port==0&&e.time==2;})==1,"calendar reset");
        require(std::none_of(out.begin(),out.end(),[](auto& e){return e.port==0&&e.time==1;}),"reset left old request");
    }
    { // Pair reset opens a fresh local namespace; no previous left survives.
        irt::simulation s;auto& d=add<irt::temporal_pair>(s);
        feed(s,d,2,1);feed(s,d,0,9);feed(s,d,5,1);feed(s,d,3,0);feed(s,d,4,0);
        feed(s,d,8,0,0,0,.5);
        feed(s,d,2,2,0,1,1);feed(s,d,9,1,0,1,1);feed(s,d,0,3,0,1,1);feed(s,d,5,1,0,1,1);feed(s,d,3,0,0,1,1);feed(s,d,4,0,0,0,1);feed(s,d,1,3,0,1,2);
        const auto out=execute(s,d);require(std::count_if(out.begin(),out.end(),[](auto& e){return e.port==0&&e.value[0]==3&&e.time==2;})==1,"pair reset retained an old value");
    }
    std::cout<<"TEMPORAL_NATIVE_PASS 24\n";
}
