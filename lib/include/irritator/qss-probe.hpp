// Included at the end of core.hpp, inside namespace irt. These helpers only
// access the calling QSS atom's owned state. They never inspect another model.
template<class Qss>
status qss_probe_transition(simulation& sim, Qss& q, time t, time e, time r) noexcept
{
    const auto id = sim.get_id(q);
    auto* state = sim.event_states.get(id);
    // lambda is pure: consume its already-owned head in delta_int/delta_con.
    if (get_model(q).tn == t and state and not state->probe_replies.empty())
        state->probe_replies.erase(state->probe_replies.begin());

    const bool physical_input = not get_message(sim, q.x[0]).empty() or
                                not get_message(sim, q.x[1]).empty();
    if (physical_input or t == q.physical_deadline)
        irt_check(q.physical_transition(sim, t, e, r));

    const auto probes = get_message(sim, q.x[2]);
    if (not probes.empty()) {
        if (not state) {
            if (not sim.event_states.data.reserve(sim.event_states.size() + 1))
                return make_error(simulation_errc::event_capacity_error);
            sim.event_states.set(id, event_state{});
            state = sim.event_states.get(id);
        }
        constexpr sz max_replies = 4096;
        if (state->probe_replies.size() + probes.size() > max_replies or
            not state->probe_replies.reserve(state->probe_replies.size() + probes.size()))
            return make_error(simulation_errc::event_capacity_error);
        // Evaluate after the physical bag, exactly once per receiving transition.
        const auto value = q.observation(t, t - q.physical_origin).value;
        for (const auto& request : probes) {
            const auto identifier = [](real n) {
                return std::isfinite(n) and n >= 1 and n <= 9007199254740991.0 and std::floor(n) == n;
            };
            if (not identifier(request[0]) or not identifier(request[1]) or request[2] != 0)
                return make_error(simulation_errc::event_protocol_error);
            state->probe_replies.push_back(message{value, request[0], request[1]});
        }
    }
    q.reply_count = state ? state->probe_replies.size() : 0;
    return success();
}

template<class Qss>
status qss_probe_lambda(simulation& sim, const Qss& q) noexcept
{
    if (sim.current_time() == q.physical_deadline)
        irt_check(q.physical_output(sim));
    if (q.reply_count) {
        const auto* state = sim.event_states.get(sim.get_id(q));
        if (not state or state->probe_replies.empty())
            return make_error(simulation_errc::event_protocol_error);
        const auto& reply = state->probe_replies.front();
        irt_check(send_message(sim, q.y[1], reply[0], reply[1], reply[2]));
    }
    return success();
}
