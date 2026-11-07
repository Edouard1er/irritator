// Exact DEVS messages complement HTTP's sampled observations.
void campaign_native_tests()
{
    { // Empty extrema/mean are unavailable; sum/count of empty sets are zero.
        for (int operation = 0; operation < 5; ++operation) {
            irt::simulation s; auto& a = add<irt::campaign_aggregate>(s);
            s.parameters[s.get_id(a)].integers[0] = operation;
            auto& end = tag(s, 0, 0, 4); checked(wire(s, end, 0, a, 1), "empty aggregate end");
            const auto events = execute(s, a); const bool valid = operation == 2 || operation == 4;
            require(events.size() == 2 && events[0].port == (valid ? 0 : 1) && events[0].value[0] == 0, "empty aggregate payload");
            require(events[1].port == 2 && events[1].value[0] == (valid ? 1 : 0) && events[1].value[2] == 4, "empty aggregate closure");
        }
    }
    for (int operation = 0; operation < 5; ++operation) {
        irt::simulation s; auto& a = add<irt::campaign_aggregate>(s);
        s.parameters[s.get_id(a)].integers[0] = operation;
        auto& end = tag(s, 3, 0, 7); checked(wire(s, end, 0, a, 1), "aggregate early end");
        for (int i = 0; i < 3; ++i) {
            auto& v = tag(s, i == 2 ? 40 : 10 * (i + 1), i, 7, .2 * (i + 1));
            checked(wire(s, v, 0, a, 0), "aggregate value");
        }
        const auto events = execute(s, a);
        const double expected[] = {10, 40, 70, 70. / 3, 3};
        require(events.size() == 2 && std::abs(events[0].time - .6) < 1e-12, "aggregate emitted early");
        require(events[0].port == 0 && events[0].value[0] == expected[operation] && events[0].value[1] == 0 && events[0].value[2] == 7, "aggregate value/key");
        require(events[1].port == 2 && events[1].value[0] == 1, "aggregate end");
        require(s.event_states.get(s.get_id(a))->rows.empty() && s.event_states.get(s.get_id(a))->barriers.empty(), "aggregate retained cohort");
    }
    { // Broadcast and division, two overlapping cohorts, all exact identities.
        irt::simulation s; auto& a = add<irt::campaign_aggregate>(s); auto& join = add<irt::campaign_broadcast>(s); auto& op = add<irt::event_operator>(s);
        s.parameters[s.get_id(a)].integers[0] = 1;
        s.parameters[s.get_id(op)].integers[0] = 4; s.parameters[s.get_id(op)].integers[1] = 3;
        checked(wire(s, a, 0, join, 1), "aggregate -> join"); checked(wire(s, a, 2, join, 3), "aggregate end -> join");
        checked(wire(s, join, 0, op, 0), "join a"); checked(wire(s, join, 1, op, 1), "join b"); checked(wire(s, join, 2, op, 3), "join end");
        for (int c = 1; c <= 2; ++c) {
            auto& end = tag(s, 3, 0, c);
            checked(wire(s, end, 0, a, 1), "end a"); checked(wire(s, end, 0, join, 2), "end join");
            for (int i = 0; i < 3; ++i) {
                auto& v = tag(s, c == 1 ? (i == 2 ? 40 : 10 * (i + 1)) : (i + 1) * 7, i, c, c == 1 ? .8 : .3);
                checked(wire(s, v, 0, a, 0), "value a"); checked(wire(s, v, 0, join, 0), "value join");
            }
        }
        const auto events = execute(s, op);
        require(events.size() == 8, "normalization FIFO size");
        for (int c = 1; c <= 2; ++c) for (int i = 0; i < 3; ++i) {
            const auto found = std::find_if(events.begin(), events.end(), [=](const auto& e) { return e.port == 0 && e.value[1] == i && e.value[2] == c; });
            const double expected = c == 1 ? (i == 2 ? 1. : .25 * (i + 1)) : (i + 1) / 3.;
            require(found != events.end() && found->value[0] == expected && found->time == (c == 1 ? .8 : .3), "normalization identity/value/date");
        }
        for (auto id : {s.get_id(a), s.get_id(join), s.get_id(op)}) require(s.event_states.get(id)->rows.empty() && s.event_states.get(id)->barriers.empty(), "normalization leaked campaign");
    }
    { // In-flight copies and snapshots own aggregate/barrier/queued data.
        irt::simulation s; auto& a = add<irt::campaign_aggregate>(s);
        auto& v = tag(s, 17, 5, 8); checked(wire(s, v, 0, a, 0), "snapshot write");
        s.limits.set_bound(0, 3); checked(s.initialize(), "snapshot initialize");
        while (s.event_states.get(s.get_id(a))->rows.empty()) checked(s.run(), "snapshot run");
        irt::simulation_snapshot snapshot(s); irt::simulation copy(s);
        copy.event_states.get(s.get_id(a))->rows[0].a = 999;
        copy.event_states.get(s.get_id(a))->barriers[0].aggregate = 999;
        require(s.event_states.get(s.get_id(a))->rows[0].a == 17 && s.event_states.get(s.get_id(a))->barriers[0].aggregate == 0, "campaign copy aliased");
        copy = snapshot;
        require(copy.event_states.get(s.get_id(a))->rows[0].a == 17, "campaign snapshot omitted rows");
        checked(copy.initialize(), "campaign reinitialize");
        require(copy.event_states.get(s.get_id(a))->rows.empty(), "initialize retained campaign");
    }
    { // Reset is applied before the data and closure in the same bag.
        irt::simulation s; auto& a = add<irt::campaign_aggregate>(s);
        auto& old = constant(s, 99); auto& reset = constant(s, 0, 1); auto& value = constant(s, 7, 1); auto& end = constant(s, 1, 1);
        checked(wire(s, old, 0, a, 0), "old aggregate"); checked(wire(s, reset, 0, a, 2), "reset aggregate");
        checked(wire(s, value, 0, a, 0), "new aggregate"); checked(wire(s, end, 0, a, 1), "new end");
        const auto events = execute(s, a);
        require(events.size() == 2 && events[0].value[0] == 7 && events[0].time == 1, "aggregate reset confluence");
    }
    { // Nonfinite inputs and overflow never become scientific results.
        for (const auto value : {std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN(), 1.7e308}) {
            irt::simulation s; auto& a = add<irt::campaign_aggregate>(s);
            s.parameters[s.get_id(a)].integers[0] = 2;
            auto& end = tag(s, 2, 0, 1); checked(wire(s, end, 0, a, 1), "invalid aggregate end");
            for (int i = 0; i < 2; ++i) {
                // Event_tag forwards the numeric payload; only source parameters
                // are finite. Inject nonfinite data after initialization below.
                auto& v = tag(s, 1, i, 1); checked(wire(s, v, 0, a, 0), "invalid aggregate value");
            }
            for (int port = 0; port < 3; ++port) { auto& sink = add<irt::counter>(s); checked(wire(s, a, port, sink, 0), "invalid sink"); }
            s.limits.set_bound(0, 3); checked(s.initialize(), "invalid initialize");
            for (auto& model : s.models) if (model.type == irt::dynamics_type::constant) {
                auto& d = irt::get_dyn<irt::constant>(model);
                if (d.value == 1) d.value = value;
            }
            bool invalid = false, closed = false;
            // Inspect pending emissions directly; initialization is already done.
            for (int i = 0; i < 100 && not s.current_time_expired(); ++i) {
                checked(s.run(), "invalid run");
                for (const auto& e : s.event_states.get(s.get_id(a))->pending) {
                    invalid = invalid or e.port == 1;
                    closed = closed or (e.port == 2 && e.value[0] == 0);
                }
            }
            require(invalid && closed, "nonfinite reduction was accepted");
        }
    }
    { // Forty sequential reductions with capacity=1 free their own runtime.
        irt::simulation s; auto& a = add<irt::campaign_aggregate>(s);
        s.parameters[s.get_id(a)].integers[3] = 1;
        for (int c = 0; c < 40; ++c) {
            auto& v = tag(s, c, 0, c, c * .05); auto& end = tag(s, 1, 0, c, c * .05 + .01);
            checked(wire(s, v, 0, a, 0), "sequence value"); checked(wire(s, end, 0, a, 1), "sequence end");
        }
        const auto events = execute(s, a); require(events.size() == 80, "sequential campaign lost");
        require(s.event_states.get(s.get_id(a))->barriers.empty(), "sequential campaign leak");
    }
    { // Two criteria tie before numeric identity; action arrives last.
        irt::simulation s; auto& pick = add<irt::candidate_select>(s);
        s.parameters[s.get_id(pick)].reals[1] = 1;
        for (int id : {20, 10, 30}) {
            auto& a = tag(s, 9, id, 2); auto& b = tag(s, id == 20 ? 1 : 2, id, 2); auto& act = tag(s, id * 10, id, 2, .7);
            checked(wire(s, a, 0, pick, 0), "lex primary"); checked(wire(s, b, 0, pick, 4), "lex secondary"); checked(wire(s, act, 0, pick, 1), "lex action");
        }
        auto& end = tag(s, 3, 0, 2); checked(wire(s, end, 0, pick, 2), "lex end");
        const auto events = execute(s, pick);
        require(events.size() == 7 && events[0].time == .7 && events[0].value[0] == 100, "lex winner/action");
        require(events[3].port == 4 && events[3].value[1] == 10 && events[3].value[2] == 2, "identified action lost");
        require(events[4].port == 5 && events[4].value[0] == 2, "second score lost");
    }
    { // Primary empty, secondary real and delayed: no invented fallback action.
        irt::simulation s; auto& choice = add<irt::selection_priority>(s); auto& primary_pick = add<irt::candidate_select>(s);
        s.parameters[s.get_id(primary_pick)].integers[2] = 0;
        checked(wire(s, primary_pick, 2, choice, 1), "empty primary score"); checked(wire(s, primary_pick, 3, choice, 3), "empty primary status");
        for (const auto campaign : {1, 2}) {
            auto& primary = tag(s, 0, 0, campaign);
            auto& secondary = tag(s, campaign == 1 ? 1 : 0, 0, campaign);
            checked(wire(s, primary, 0, primary_pick, 2), "empty primary end"); checked(wire(s, secondary, 0, choice, 7), "secondary status");
        }
        auto& action = tag(s, 123, 9, 1, 1);
        auto& score = tag(s, 42, 9, 1, .5); auto& other = tag(s, 7, 9, 1, .6);
        checked(wire(s, action, 0, choice, 4), "secondary real action"); checked(wire(s, score, 0, choice, 5), "secondary score"); checked(wire(s, other, 0, choice, 6), "secondary tie score");
        const auto events = execute(s, choice);
        require(events.size() == 11, "priority FIFO size");
        require(events[0].port == 1 && events[0].value[0] == -1 && events[0].value[2] == 2, "priority empty identity");
        require(std::count_if(events.begin(), events.end(), [](const auto& e) { return e.port == 0; }) == 1, "priority invented action");
        const auto tagged_action = std::find_if(events.begin(), events.end(), [](const auto& e) { return e.port == 4; });
        require(tagged_action != events.end() && tagged_action->time == 1 && tagged_action->value[0] == 123 && tagged_action->value[1] == 9 && tagged_action->value[2] == 1, "priority lost action/key/date");
        require(s.event_states.get(s.get_id(choice))->rows.empty() && s.event_states.get(s.get_id(choice))->barriers.empty(), "priority leaked campaigns");
    }
    { // Invalid keys are rejected; incomplete campaigns never publish.
        for (const auto key : {-.5, .5, std::numeric_limits<double>::infinity()}) {
            irt::simulation s; auto& t = add<irt::event_tag>(s);
            s.parameters[s.get_id(t)].reals[0] = key;
            s.limits.set_bound(0, 3);
            const auto status = s.initialize(); require(status.has_error(), "invalid candidate key accepted");
        }
        irt::simulation s; auto& a = add<irt::campaign_aggregate>(s);
        auto& v = tag(s, 10, 0, 3); checked(wire(s, v, 0, a, 0), "unclosed aggregate value");
        require(execute(s, a).empty(), "aggregate published without closure");
        require(s.event_states.get(s.get_id(a))->rows.size() == 1, "pending cohort discarded");
        irt::simulation p; auto& choice = add<irt::selection_priority>(p);
        auto& status = tag(p, 0, 0, 3); checked(wire(p, status, 0, choice, 3), "incomplete priority");
        require(execute(p, choice).empty(), "priority published without second status");
    }
}
