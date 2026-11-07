// Included in event.cpp's anonymous namespace: generic campaign operations.
event_barrier* cohort(event_state& s, real campaign, sz capacity) noexcept
{
    for (auto& b : s.barriers) if (b.campaign == campaign) return &b;
    if (s.barriers.size() >= capacity or not s.barriers.reserve(s.barriers.size() + 1)) return nullptr;
    s.barriers.emplace_back();
    s.barriers.back().campaign = campaign;
    return &s.barriers.back();
}

template<event_kind K>
status campaign_transition(simulation& sim, event_dynamics<K>& d, event_state& s, sz capacity) noexcept
{
    if constexpr (K == event_kind::aggregate) {
        for (const auto& m : get_message(sim, d.x[0])) {
            if (not tagged(m)) return protocol_error();
            auto* b = cohort(s, m[2], capacity);
            if (not b) return capacity_error();
            if (b->sent) return protocol_error();
            auto* r = row(s, m, capacity, 0, 0, 1);
            if (not r) return capacity_error();
            r->a = m[0]; r->mask = 1;
        }
        for (const auto& m : get_message(sim, d.x[1])) irt_check(barrier(s, m, capacity));
        for (auto& b : s.barriers) if (b.ended and not b.sent) {
            sz n = 0;
            for (const auto& r : s.rows) if (r.campaign == b.campaign) ++n;
            if (n > b.expected) return protocol_error();
            if (n != b.expected) continue;
            // Stable order makes reductions independent of the arrival order.
            std::sort(s.rows.begin(), s.rows.end(), [](const auto& a, const auto& z) {
                return a.campaign < z.campaign or (a.campaign == z.campaign and a.key < z.key);
            });
            long double sum = 0;
            real lo = std::numeric_limits<real>::infinity(), hi = -lo;
            bool valid = true;
            for (const auto& r : s.rows) if (r.campaign == b.campaign) {
                valid = valid and std::isfinite(r.a);
                sum += static_cast<long double>(r.a);
                lo = std::min(lo, r.a); hi = std::max(hi, r.a);
            }
            real result = 0;
            switch (d.integers[0]) {
            case 0: result = lo; break;
            case 1: result = hi; break;
            case 2: result = static_cast<real>(sum); break;
            case 3: result = n ? static_cast<real>(sum / n) : std::numeric_limits<real>::quiet_NaN(); break;
            case 4: result = real(n); break;
            }
            valid = valid and std::isfinite(result);
            irt_check(emit(s, valid ? 0 : 1, valid ? result : 0, 0, b.campaign));
            irt_check(emit(s, 2, valid ? 1 : 0, 0, b.campaign));
            if (valid) d.value = result;
            b.sent = true;
        }
    } else if constexpr (K == event_kind::broadcast) {
        for (int port = 0; port < 4; ++port) for (const auto& m : get_message(sim, d.x[port])) {
            if (not tagged(m)) return protocol_error();
            auto* b = cohort(s, m[2], capacity);
            if (not b) return capacity_error();
            if (b->sent) return protocol_error();
            if (port == 0) {
                auto* r = row(s, m, capacity, 0, 0, 1);
                if (not r) return capacity_error();
                r->a = m[0]; r->mask = 1;
            } else if (port == 1) {
                if (m[1] != 0 or b->has_aggregate) return protocol_error();
                b->aggregate = m[0]; b->has_aggregate = true;
            } else {
                if (not event_identifier(m[0]) or m[0] > real(capacity)) return protocol_error();
                if (port == 2) {
                    if (b->ended and b->expected != sz(m[0])) return protocol_error();
                    b->ended = true; b->expected = sz(m[0]);
                } else {
                    if (m[0] > 1 or (b->aggregate_ended and b->aggregate_expected != sz(m[0]))) return protocol_error();
                    b->aggregate_ended = true; b->aggregate_expected = sz(m[0]);
                }
            }
        }
        for (auto& b : s.barriers) if (b.ended and b.aggregate_ended and not b.sent) {
            sz n = 0;
            for (const auto& r : s.rows) if (r.campaign == b.campaign) ++n;
            if (n > b.expected or (b.has_aggregate and b.aggregate_expected == 0)) return protocol_error();
            if (n != b.expected or (b.aggregate_expected == 1 and not b.has_aggregate)) continue;
            sz accepted = 0;
            for (const auto& r : s.rows) if (r.campaign == b.campaign) {
                if (b.has_aggregate and std::isfinite(b.aggregate) and std::isfinite(r.a)) {
                    irt_check(emit(s, 0, r.a, r.key, r.campaign));
                    irt_check(emit(s, 1, b.aggregate, r.key, r.campaign));
                    ++accepted; d.value = b.aggregate;
                } else irt_check(emit(s, 3, 0, r.key, r.campaign));
            }
            irt_check(emit(s, 2, real(accepted), 0, b.campaign)); b.sent = true;
        }
    } else if constexpr (K == event_kind::priority) {
        for (int port = 0; port < 8; ++port) for (const auto& m : get_message(sim, d.x[port])) {
            const auto field = port % 4, branch = port / 4;
            if (not event_identifier(m[2])) return protocol_error();
            // candidate_select's empty score is a status marker, never a row.
            // It precedes selected=0 in the FIFO and carries identity -1.
            if (field == 1 and m[0] == 0 and m[1] == -1) continue;
            if (field == 3) {
                if ((m[0] != 0 and m[0] != 1) or m[1] != 0) return protocol_error();
            } else if (not tagged(m) or not std::isfinite(m[0])) return protocol_error();
            auto* b = cohort(s, m[2], capacity);
            if (not b) return capacity_error();
            if (b->sent) return protocol_error();
            auto* r = row(s, message{0, real(branch), m[2]}, capacity, 0, 0, 0);
            if (not r) return capacity_error();
            if (r->mask & (1u << field)) return protocol_error();
            if (field != 3) {
                if ((r->mask & 7) and r->identity != m[1]) return protocol_error();
                r->identity = m[1];
            }
            if (field == 0) r->b = m[0];
            if (field == 1) r->a = m[0];
            if (field == 2) r->secondary = m[0];
            if (field == 3) r->condition = m[0];
            r->mask |= 1u << field;
        }
        for (auto& b : s.barriers) if (not b.sent) {
            event_row* branches[2] = {};
            for (auto& r : s.rows) if (r.campaign == b.campaign) branches[int(r.key)] = &r;
            bool ready = true;
            for (auto* r : branches) if (not r or not (r->mask & 8) or (r->condition != 0 and (r->mask & 7) != 7)) ready = false;
            if (not ready) continue;
            event_row* best = nullptr;
            for (auto* r : branches) if (r->condition != 0 and (not best or d.reals[int(r->key)] < d.reals[int(best->key)])) best = r;
            const auto id = best ? best->identity : -1;
            if (best) {
                irt_check(emit(s, 0, best->b, 0, 0));
                irt_check(emit(s, 4, best->b, id, b.campaign)); d.value = best->b;
            }
            irt_check(emit(s, 1, id, id, b.campaign));
            irt_check(emit(s, 2, best ? best->a : 0, id, b.campaign));
            if (best) irt_check(emit(s, 5, best->secondary, id, b.campaign));
            irt_check(emit(s, 3, best ? 1 : 0, 0, b.campaign));
            irt_check(emit(s, 6, best ? 1 : 0, 0, b.campaign)); b.sent = true;
        }
    }
    return success();
}
