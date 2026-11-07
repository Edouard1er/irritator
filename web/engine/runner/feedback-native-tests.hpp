// Direct engine audit: neither HTTP observations nor chart samples are inputs.
void feedback_audit_tests()
{
    irt::simulation s;
    auto& x = add<irt::qss3_integrator>(s);
    s.parameters[s.get_id(x)].set_integrator(10, .01);
    auto& u = constant(s, 2);
    auto& memory = add<irt::value_memory>(s);
    auto& read = constant(s, 0, 1);
    auto& clean = add<irt::event_tag>(s);
    checked(wire(s, u, 0, x, 0), "audit derivative");
    checked(wire(s, x, 0, clean, 0), "audit strip QSS derivatives");
    checked(wire(s, clean, 0, memory, 0), "audit store emitted value");
    checked(wire(s, read, 0, memory, 1), "audit read");
    const auto events = execute(s, memory);
    require(events.size() == 1 && events[0].time == 1 && std::abs(events[0].value[0] - 10.01) < 1e-12,
            "last QSS output is not current continuous state");
    require(x.observation(1, 1 - irt::get_model(x).tl).value == 12,
            "native continuous state at decision is 12");
    std::cout << "audit t=1: last emitted=" << events[0].value[0]
              << "; current X=" << x.observation(1, 1 - irt::get_model(x).tl).value << '\n';

    irt::simulation action;
    auto& main = add<irt::qss3_integrator>(action);
    action.parameters[action.get_id(main)].set_integrator(10, .01);
    auto& hold = add<irt::zero_order_hold>(action);
    auto& initial = constant(action, 2);
    auto& changed = tag(action, -1, 17, 8, 1);
    checked(wire(action, initial, 0, hold, 0), "audit initial action");
    checked(wire(action, changed, 0, hold, 0), "audit identified action");
    checked(wire(action, hold, 0, main, 0), "audit held derivative");
    execute(action, changed);
    require(hold.held == -1 && main.u == -1 && main.mu == 0 && main.pu == 0,
            "hold must strip identities rather than use them as QSS derivatives");
    require(main.observation(2, 2 - irt::get_model(main).tl).value == 11,
            "held action really changes the dynamic equation");
}

void feedback_observer_tests()
{
    { // A real continuous value between quantized emissions, then a new action.
        irt::simulation s;
        auto& x = add<irt::qss3_integrator>(s);
        s.parameters[s.get_id(x)].set_integrator(10, .01);
        auto& hold = add<irt::zero_order_hold>(s);
        auto& initial = constant(s, 2);
        auto& change = tag(s, -1, 99, 17, 1.5);
        auto& sample = add<irt::state_observer>(s);
        auto& a = tag(s, 0, 3, 1, 1);
        auto& b = tag(s, 0, 4, 2, 2);
        checked(wire(s, initial, 0, hold, 0), "initial action");
        checked(wire(s, change, 0, hold, 0), "replacement action");
        checked(wire(s, hold, 0, x, 0), "apply action");
        checked(wire(s, x, 0, sample, 0), "bind continuous state");
        checked(wire(s, a, 0, sample, 1), "first read");
        checked(wire(s, b, 0, sample, 1), "second read");
        const auto events = execute(s, sample);
        require(events.size() == 2, "observer emitted without read / lost a read");
        require(events[0].port == 0 && events[0].time == 1 && std::abs(events[0].value[0] - 12) < 1e-12 && events[0].value[1] == 3 && events[0].value[2] == 1, "first real state");
        require(events[1].port == 0 && events[1].time == 2 && std::abs(events[1].value[0] - 12.5) < 1e-12 && events[1].value[1] == 4 && events[1].value[2] == 2, "updated real state");
        const auto id = s.get_id(sample);
        irt::simulation copy(s); irt::simulation_snapshot snapshot(s);
        require(copy.event_states.get(id)->source == s.get_id(x), "copy binding lost");
        auto& copy_x = irt::get_dyn<irt::qss3_integrator>(copy.models.get(s.get_id(x)));
        copy_x.X = 999;
        require(x.X != 999, "observer copy aliased source");
        copy = snapshot;
        require(copy.event_states.get(id)->source == s.get_id(x), "snapshot binding lost");
        const auto replay = execute(s, sample);
        require(replay.size() == events.size() && replay[0].value == events[0].value && replay[1].value == events[1].value,
                "full reset reused stale observation or action");
    }
    for (const bool reverse : {false, true}) {
        // Reset and read from the very same native bag, with opposite IDs.
        irt::simulation s;
        irt::state_observer* sample = reverse ? &add<irt::state_observer>(s) : nullptr;
        auto& x = add<irt::qss3_integrator>(s);
        if (not sample) sample = &add<irt::state_observer>(s);
        s.parameters[s.get_id(x)].set_integrator(10, .01);
        auto& initial = constant(s, 2);
        auto& reset_and_read = constant(s, 7, 1);
        checked(wire(s, initial, 0, x, 0), "initial derivative");
        checked(wire(s, x, 0, *sample, 0), "state binding");
        checked(wire(s, reset_and_read, 0, x, 1), "same bag reset");
        checked(wire(s, reset_and_read, 0, *sample, 1), "same bag read");
        const auto events = execute(s, *sample);
        require(events.size() == 1 && events[0].value[0] == 7 && events[0].time == 1, "read raced with source reset");
    }
    { // The native X is cubic; the QSS3 output is only a quadratic polynomial.
        irt::simulation s;
        auto& ramp = add<irt::qss3_integrator>(s);
        auto& square = add<irt::qss3_square>(s);
        auto& x = add<irt::qss3_integrator>(s);
        s.parameters[s.get_id(ramp)].set_integrator(0, .01);
        s.parameters[s.get_id(x)].set_integrator(10, 1000);
        auto& one = constant(s, 1);
        auto& read = constant(s, 0, 1);
        auto& sample = add<irt::state_observer>(s);
        auto& last_emission = add<irt::zero_order_hold>(s);
        checked(wire(s, one, 0, ramp, 0), "ramp derivative");
        checked(wire(s, ramp, 0, square, 0), "square ramp");
        checked(wire(s, square, 0, x, 0), "quadratic derivative");
        checked(wire(s, x, 0, sample, 0), "cubic state binding");
        checked(wire(s, x, 0, last_emission, 0), "last quantized cubic emission");
        checked(wire(s, read, 0, sample, 1), "cubic read");
        const auto events = execute(s, sample);
        const auto native = x.observation(1, 1 - irt::get_model(x).tl).value;
        require(events.size() == 1 && std::abs(events[0].value[0] - native) < 1e-12 && native > 10.3 && last_emission.held == 10,
                "observer reconstructed quantized output instead of native cubic X");
    }
    { // An absent source has an explicit missing response, never initial X.
        irt::simulation s; auto& sample = add<irt::state_observer>(s);
        auto& read = tag(s, 0, 2, 8, 1);
        checked(wire(s, read, 0, sample, 1), "unbound read");
        const auto events = execute(s, sample);
        require(events.size() == 1 && events[0].port == 1 && events[0].value == irt::message{0, 2, 8}, "missing source fabricated observation");
    }
    { // More commands than capacity in one real bag fail deterministically.
        irt::simulation s; auto& sample = add<irt::state_observer>(s);
        s.parameters[s.get_id(sample)].integers[3] = 1;
        auto& a = constant(s, 0, 1); auto& b = constant(s, 0, 1);
        checked(wire(s, a, 0, sample, 1), "capacity read A"); checked(wire(s, b, 0, sample, 1), "capacity read B");
        s.limits.set_bound(0, 3); checked(s.initialize(), "capacity initialize");
        bool failed = false;
        for (int n = 0; n < 20 && !s.current_time_expired(); ++n) if (s.run().has_error()) { failed = true; break; }
        require(failed, "observer ignored its read capacity");
    }
    { // Reset and read together discard no new command from that same bag.
        irt::simulation s; auto& sample = add<irt::state_observer>(s);
        auto& x = add<irt::qss1_integrator>(s);
        s.parameters[s.get_id(x)].set_integrator(7, .01);
        auto& read = constant(s, 0, 1);
        checked(wire(s, x, 0, sample, 0), "QSS1 source");
        checked(wire(s, read, 0, sample, 1), "reset read"); checked(wire(s, read, 0, sample, 2), "reset observer");
        const auto events = execute(s, sample);
        require(events.size() == 1 && events[0].port == 0 && events[0].value[0] == 7, "observer reset lost confluent read");
    }
}
