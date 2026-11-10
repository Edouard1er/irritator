// Included in event.cpp. Scheduling, admission and pairing only; arithmetic
// and reductions belong to the ordinary numeric/aggregation components.
temporal_record* temporal_row(event_state& s, const message& m, sz capacity) noexcept
{
    for (auto& r : s.temporal) if (r.key == m[1] and r.campaign == m[2]) return &r;
    if (s.temporal.size() >= capacity or not s.temporal.reserve(s.temporal.size()+1)) return nullptr;
    s.temporal.emplace_back();
    auto& r = s.temporal.back(); r.key = m[1]; r.campaign = m[2];
    return &r;
}
status calendar_transition(simulation& sim, event_calendar& d, event_state& s, time t, sz capacity) noexcept
{
    // Reset was handled first. Cancel wins over a concurrent request/due event
    // that has not already been emitted in an earlier DEVS bag.
    for (const auto& m : get_message(sim, d.x[0])) {
        if (not tagged(m) or not std::isfinite(m[0]) or (d.integers[0] ? m[0] < 0 : m[0] < t)) return protocol_error();
        auto* r = temporal_row(s, m, capacity); if (not r) return capacity_error();
        if (r->mask or r->status) return protocol_error();
        r->due = d.integers[0] ? t + m[0] : m[0]; r->origin = t; r->mask = 1;
        if (not std::isfinite(r->due) or r->due < t) return protocol_error();
        irt_check(emit(s, 2, r->due, r->key, r->campaign));
    }
    for (const auto& m : get_message(sim, d.x[1])) {
        if (not tagged(m)) return protocol_error();
        auto* r = temporal_row(s, m, capacity); if (not r) return capacity_error();
        if (r->status) return protocol_error();
        r->status = 2; irt_check(emit(s, 1, 2, r->key, r->campaign));
    }
    for (auto& r : s.temporal) if (r.mask and not r.status and r.due <= t) {
        r.status = 1; irt_check(emit(s, 0, r.due, r.key, r.campaign));
    }
    return success();
}
status temporal_transition(simulation& sim, temporal_pair& d, event_state& s, time t, sz capacity) noexcept
{
    bool changed = false;
    for (const auto& m : get_message(sim, d.x[4])) {
        changed = true;
        // Context is a scalar signal, not an identified row. Same-time updates
        // replace its right-continuous value; tv itself is outside [t0,tv).
        if (not s.contexts.empty() and s.contexts.back().date == t) s.contexts.back().value = m[0];
        else {
            if (s.contexts.size() >= capacity or not s.contexts.reserve(s.contexts.size()+1)) return capacity_error();
            s.contexts.emplace_back(event_context{t, m[0]});
        }
    }
    constexpr int ports[] = {2, 0, 1, 3, 5, 9, 6, 7};
    constexpr unsigned bits[] = {4, 1, 2, 8, 16, 128, 32, 64};
    for (int i = 0; i < 8; ++i) for (const auto& m : get_message(sim, d.x[ports[i]])) {
        changed = true;
        if (not tagged(m)) return protocol_error();
        auto* r = temporal_row(s, m, capacity); if (not r) return capacity_error();
        if (r->status == 1 and ports[i] == 7) continue; // cohort seal after completion
        if (r->status == 1 or (r->mask & bits[i])) return protocol_error();
        r->mask |= bits[i];
        switch (ports[i]) {
        case 2: r->origin = t; r->due = m[0]; break;
        case 0: r->left = m[0]; r->left_time = t; break;
        case 1: r->right = m[0]; r->right_time = t; break;
        case 3: r->assumption = m[0]; break;
        case 5: r->validity = m[0]; break;
        case 9: r->duration = m[0]; break;
        case 6: if (not r->status) r->status = 7; break;
        case 7: break;
        }
    }
    if (not changed) return success();
    for (auto& r : s.temporal) {
        if (r.announced) continue;
        if (not r.status) {
            const bool dated = (r.mask & 4) != 0;
            if ((dated and (not std::isfinite(r.due) or r.due <= r.origin)) or
                (dated and (r.mask & 128) and (not std::isfinite(r.duration) or r.duration <= 0 or r.origin + r.duration != r.due)) or
                (dated and (r.mask & 1) and r.left_time != r.origin) or
                ((r.mask & 2) and (not dated or r.right_time != r.due))) r.status = 5;
            else if (((r.mask & 1) and not std::isfinite(r.left)) or
                     ((r.mask & 2) and not std::isfinite(r.right)) or
                     ((r.mask & 16) and r.validity != 1)) r.status = 2;
            else if (dated and (r.mask & (d.integers[1] ? 147u : 19u)) == (d.integers[1] ? 147u : 19u)) {
                if (d.integers[0]) {
                    if (not (r.mask & 8)) { if (r.mask & 64) r.status = 3; }
                    else {
                        bool known = false, compatible = std::isfinite(r.assumption);
                        real initial = 0;
                        for (const auto& c : s.contexts) {
                            if (c.date <= r.origin) { initial = c.value; known = true; }
                            else if (c.date < r.due) compatible = compatible and c.value == r.assumption;
                        }
                        r.status = known and compatible and initial == r.assumption ? 1 : 6;
                    }
                } else r.status = 1;
            }
            if (not r.status and (r.mask & 64)) r.status = not dated or (r.mask & 17) != 17 or (d.integers[1] and not (r.mask & 128)) ? 3 : 4;
        }
        if (r.status) {
            if (r.status == 1) {
                irt_check(emit(s, 0, r.left, r.key, r.campaign));
                irt_check(emit(s, 1, r.right, r.key, r.campaign));
            }
            irt_check(emit(s, 2, real(r.status), r.key, r.campaign));
            r.announced = true;
        }
    }
    sz verified = 0, pending = 0, invalid = 0;
    for (const auto& r : s.temporal) {
        if (r.status == 1) ++verified; else if (r.status) ++invalid; else ++pending;
    }
    irt_check(emit(s, 3, real(verified), 0, 0));
    irt_check(emit(s, 4, real(pending), 0, 0));
    irt_check(emit(s, 5, real(invalid), 0, 0));
    return success();
}
