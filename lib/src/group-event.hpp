// Included in event.cpp's anonymous namespace. No scientific policy here.
bool group_closed(const event_state& s, real campaign) noexcept
{
    for (const auto& r : s.closed) if (campaign >= r.first and campaign <= r.last) return true;
    return false;
}
status group_retire(event_state& s, real campaign, sz capacity) noexcept
{
    if (not s.closed.reserve(s.closed.size() + 1)) return capacity_error();
    s.closed.emplace_back(event_closed_range{campaign, campaign});
    std::sort(s.closed.begin(), s.closed.end(), [](auto a, auto b) { return a.first < b.first; });
    sz n = 0;
    for (sz i = 0; i < s.closed.size(); ++i) {
        const auto next = s.closed[i];
        if (n and next.first <= s.closed[n-1].last + 1) s.closed[n-1].last = std::max(s.closed[n-1].last, next.last);
        else s.closed[n++] = next;
    }
    s.closed.resize(n);
    return n > capacity ? capacity_error() : success();
}
status group_transition(simulation& sim, group_aggregate& d, event_state& s, sz capacity) noexcept
{
    bool changed = false;
    // Fields arrive independently; duplicates are errors, never overwrites.
    constexpr unsigned bits[] = {16, 8, 1, 2, 4};
    for (int port = 0; port < 5; ++port) for (const auto& m : get_message(sim, d.x[port])) {
        changed = true;
        if (not tagged(m) or group_closed(s, m[2])) return protocol_error();
        auto* b = cohort(s, m[2], capacity);
        if (not b) return capacity_error();
        if (b->sent or b->sealed) return protocol_error();
        group_row* r = nullptr;
        for (auto& item : s.groups) if (item.scenario == m[1] and item.campaign == m[2]) { r = &item; break; }
        if (not r) {
            if (s.groups.size() >= capacity or not s.groups.reserve(s.groups.size()+1)) return capacity_error();
            s.groups.emplace_back(); r = &s.groups.back(); r->scenario = m[1]; r->campaign = m[2];
        }
        if (r->mask & bits[port]) return protocol_error();
        if (port == 0) r->key = m[0];
        if (port == 1) r->action = m[0];
        if (port == 2) r->value = m[0];
        if (port == 3) { if (m[0] != 0 and m[0] != 1) return protocol_error(); r->valid = m[0]; }
        if (port == 4) r->weight = m[0];
        r->mask |= bits[port];
    }
    for (const auto& m : get_message(sim, d.x[5])) {
        changed = true;
        const real count = m[d.reals[0] == 1 ? 1 : 0];
        if (not event_identifier(m[2]) or not event_identifier(count) or count > real(capacity) or
            not event_identifier(m[0]) or (d.reals[0] == 0 and m[1] != 0) or
            (d.reals[0] == 1 and m[0] > count) or group_closed(s, m[2])) return protocol_error();
        auto* b = cohort(s, m[2], capacity);
        if (not b) return capacity_error();
        if (b->ended or b->sent) return protocol_error();
        b->ended = true; b->expected = sz(count);
    }
    for (const auto& m : get_message(sim, d.x[6])) {
        changed = true;
        if (not tagged(m) or m[1] != 0) return protocol_error();
        // A shared seal may reach several metric branches, some already
        // complete. It acknowledges them without reopening or duplicating data.
        if (group_closed(s, m[2])) continue;
        auto* b = cohort(s, m[2], capacity);
        if (not b) return capacity_error();
        if (not b->ended or b->sent or b->sealed) return protocol_error();
        b->sealed = true;
    }
    // Draining one owned FIFO item must not repeatedly sort/reduce the same
    // campaign. A waiting frame can only progress when a new input arrives.
    if (not changed) return success();
    const auto required = unsigned(d.integers[2]) | 16u | (d.integers[0] != 4 ? 1u : 0u) | (d.integers[0] >= 5 ? 4u : 0u);
    std::sort(s.groups.begin(), s.groups.end(), [](const auto& a, const auto& b) {
        return a.campaign < b.campaign or (a.campaign == b.campaign and a.scenario < b.scenario);
    });
    const auto ready = [required](const group_row& r) {
        // An explicit invalid status needs no invented numerical value/weight.
        const auto mask = (r.mask & 2) and r.valid == 0 ? required & ~(1u | 4u) : required;
        return (r.mask & mask) == mask;
    };
    for (auto& b : s.barriers) if (b.ended and not b.sent) {
        sz received = 0; bool missing = false, unknown = false;
        for (const auto& r : s.groups) if (r.campaign == b.campaign) {
            ++received; missing = missing or not ready(r);
            unknown = unknown or not (r.mask & 16) or not std::isfinite(r.key);
        }
        if (received > b.expected) return protocol_error();
        missing = missing or received != b.expected;
        if (missing and not b.sealed) {
            if (not b.waiting_reported) { irt_check(emit(s, 8, 3, 0, b.campaign)); b.waiting_reported = true; }
            continue;
        }
        sz accepted = 0; bool complete = not missing and not unknown;
        for (const auto& first : s.groups) if (first.campaign == b.campaign and (first.mask & 16) and std::isfinite(first.key)) {
            // The smallest originating scenario ID is the group ID, independent
            // of arrival order, operation, precision formatting or metric.
            bool earlier = false;
            for (const auto& r : s.groups) if (r.campaign == b.campaign and r.scenario < first.scenario and (r.mask & 16) and r.key == first.key) earlier = true;
            if (earlier) continue;
            sz total = 0, valid = 0; long double sum = 0, weights = 0;
            real lo = std::numeric_limits<real>::infinity(), hi = -lo;
            real action = first.key; bool has_action = false, consistent = true;
            for (const auto& r : s.groups) if (r.campaign == b.campaign and (r.mask & 16) and r.key == first.key) {
                if (not (r.mask & 8) and (required & 8)) continue;
                const real candidate = (r.mask & 8) ? r.action : r.key;
                if (not std::isfinite(candidate)) continue;
                if (has_action and candidate != action) consistent = false;
                action = candidate; has_action = true;
            }
            for (const auto& r : s.groups) if (r.campaign == b.campaign and (r.mask & 16) and r.key == first.key) {
                ++total;
                const auto member_action = (r.mask & 8) ? r.action : r.key;
                irt_check(emit(s, 6, r.scenario, first.scenario, b.campaign));
                if (not ready(r) or r.valid == 0 or not std::isfinite(r.value) or not std::isfinite(member_action) or
                    ((required & 4) and (not std::isfinite(r.weight) or r.weight < 0))) continue;
                ++valid; lo = std::min(lo, r.value); hi = std::max(hi, r.value);
                sum += static_cast<long double>(r.value) * (d.integers[0] >= 5 ? static_cast<long double>(r.weight) : 1.L);
                weights += static_cast<long double>(r.weight);
            }
            // One action must describe the entire group. Conflicts are a
            // malformed graph/manifest, not a candidate to silently choose.
            if (not consistent) return protocol_error();
            const bool full = not missing and not unknown and valid == total;
            real result = 0;
            switch (d.integers[0]) {
            case 0: result = lo; break;
            case 1: result = hi; break;
            case 2: case 5: result = real(sum); break;
            case 3: result = valid ? real(sum / valid) : std::numeric_limits<real>::quiet_NaN(); break;
            case 4: result = real(valid); break;
            case 6: result = weights > 0 ? real(sum / weights) : std::numeric_limits<real>::quiet_NaN(); break;
            }
            const bool usable = has_action and valid > 0 and std::isfinite(result) and (d.integers[1] == 1 or full);
            const real status = usable ? (full ? 1 : 2) : 0;
            complete = complete and full and usable;
            irt_check(emit(s, 9, first.key, first.scenario, b.campaign));
            irt_check(emit(s, 3, status, first.scenario, b.campaign));
            irt_check(emit(s, 4, real(valid), first.scenario, b.campaign));
            irt_check(emit(s, 5, real(total), first.scenario, b.campaign));
            if (usable) {
                irt_check(emit(s, 0, result, first.scenario, b.campaign));
                irt_check(emit(s, 1, action, first.scenario, b.campaign));
                d.value = result; ++accepted;
            } else irt_check(emit(s, 7, missing or unknown ? 1 : valid != total ? 2 : 3, first.scenario, b.campaign));
        }
        irt_check(emit(s, 8, complete ? 1 : accepted ? 2 : 0, 0, b.campaign));
        irt_check(emit(s, 2, real(accepted), 0, b.campaign));
        // Replay protection starts at capture, even while the FIFO is draining.
        irt_check(group_retire(s, b.campaign, capacity)); b.sent = true;
    }
    if (s.pending.size() > capacity * 16 + 16) return capacity_error();
    return success();
}
