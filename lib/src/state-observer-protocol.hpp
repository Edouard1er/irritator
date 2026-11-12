// Included in event.cpp's anonymous namespace. Only the observer's own
// outstanding reads are inspected. Source state travels exclusively in bags.
status observer_transition(simulation& sim, state_observer& dyn, event_state& s, sz capacity) noexcept
{
    const auto owner = static_cast<real>(sim.get_id(dyn));
    for (const auto& response : get_message(sim, dyn.x[3])) {
        if (response[2] != owner) continue; // shared-source broadcast isolation
        for (auto& read : s.observer_reads) if (read.ticket == response[1]) {
            read.value = response[0]; read.ready = true; break;
        }
        // Unknown, duplicate and cancelled tickets are deliberately ignored.
    }
    while (not s.observer_reads.empty() and s.observer_reads.front().ready) {
        const auto read = s.observer_reads.front();
        const bool valid = std::isfinite(read.value);
        irt_check(emit(s, valid ? 0 : 1, valid ? read.value : 0, read.identity[1], read.identity[2]));
        if (valid) dyn.value = read.value;
        s.observer_reads.erase(s.observer_reads.begin());
    }
    for (const auto& read : get_message(sim, dyn.x[1])) {
        if (not tagged(read)) return protocol_error();
        const auto queued_values = std::count_if(s.pending.begin(), s.pending.end(),
                                                 [](const auto& p) { return p.port != 2; });
        if (s.observer_reads.size() + queued_values >= capacity) return capacity_error();
        if (not is_defined(s.source)) {
            irt_check(emit(s, 1, 0, read[1], read[2]));
            continue;
        }
        if (s.next_ticket >= 9007199254740991.0) return protocol_error();
        if (not s.observer_reads.reserve(s.observer_reads.size() + 1)) return capacity_error();
        const auto ticket = ++s.next_ticket;
        s.observer_reads.push_back(observer_read{read, ticket});
        irt_check(emit(s, 2, ticket, owner, 0));
    }
    return success();
}
