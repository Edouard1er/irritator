#include <irritator/core.hpp>

namespace irt {
namespace {
status capacity_error() noexcept { return make_error(simulation_errc::event_capacity_error); }
status protocol_error() noexcept { return make_error(simulation_errc::event_protocol_error); }
bool event_identifier(real n) noexcept
{
    return std::isfinite(n) and n >= 0 and n <= 9007199254740991.0 and std::floor(n) == n;
}
bool tagged(const message& m) noexcept { return event_identifier(m[1]) and event_identifier(m[2]); }

event_row* row(event_state& s, const message& m, sz capacity, real a, real b, real condition) noexcept
{
    if (not tagged(m)) return nullptr;
    for (auto& r : s.rows)
        if (r.key == m[1] and r.campaign == m[2]) return &r;
    if (s.rows.size() >= capacity or not s.rows.reserve(s.rows.size() + 1)) return nullptr;
    s.rows.emplace_back(event_row{ m[1], m[2], a, b, condition });
    return &s.rows.back();
}
status emit(event_state& s, int port, real value, real key, real campaign) noexcept
{
    if (not s.pending.reserve(s.pending.size() + 1)) return capacity_error();
    s.pending.emplace_back(event_emission{ port, message{ value, key, campaign } });
    return success();
}
status barrier(event_state& s, const message& m, sz capacity) noexcept
{
    if (not event_identifier(m[0]) or not tagged(m) or m[0] > real(capacity)) return protocol_error();
    for (auto& b : s.barriers) if (b.campaign == m[2]) {
        if (b.sent or (b.ended and b.expected != sz(m[0]))) return protocol_error();
        b.expected = sz(m[0]); b.ended = true;
        return success();
    }
    if (s.barriers.size() >= capacity or not s.barriers.reserve(s.barriers.size() + 1)) return capacity_error();
    s.barriers.emplace_back(event_barrier{ m[2], sz(m[0]), false, true });
    return success();
}
real calculate(i64 op, real a, real b, real epsilon, real lower) noexcept
{
    if (not std::isfinite(a) or not std::isfinite(b)) return std::numeric_limits<real>::quiet_NaN();
    switch (op) {
    case 0: return a;
    case 1: return a + b;
    case 2: return a - b;
    case 3: return a * b;
    case 4: return std::abs(b) <= epsilon ? std::numeric_limits<real>::quiet_NaN() : a / b;
    case 5: return std::min(a, b);
    case 6: return std::max(a, b);
    case 7: return a > b;
    case 8: return a < b;
    case 9: return std::abs(a - b) <= epsilon;
    case 10: return a >= b;
    case 11: return a <= b;
    case 12: return std::abs(a - b) > epsilon;
    case 13: return a != 0 and b != 0;
    case 14: return a != 0 or b != 0;
    case 15: return a == 0;
    case 16: return std::abs(a);
    case 17: return std::pow(a, b);
    case 18: return std::sqrt(a);
    case 19: return std::log(a);
    case 20: return std::exp(a);
    case 21: return std::abs(b - lower) <= epsilon ? std::numeric_limits<real>::quiet_NaN() : (a - lower) / (b - lower);
    default: return std::numeric_limits<real>::quiet_NaN();
    }
}
#include "campaign-event.hpp"
#include "group-event.hpp"
} // namespace

status validate_structure(const simulation& sim) noexcept
{
    // Use const traversal: validation must not mutate or repair connections.
    for (const auto& observer : sim.models) {
        if (observer.type != dynamics_type::state_observer) continue;
        const auto self = sim.models.get_id(observer);
        sz bindings = 0;
        bool supported = true;
        for (const auto& candidate : sim.models) {
            dispatch(candidate, [&]<typename D>(const D& dyn) {
                if constexpr (has_output_port<D>) for (auto port : dyn.y)
                    sim.for_each(port, [&](const model& dst, int input) {
                        if (sim.models.get_id(dst) == self and input == 0) {
                            ++bindings;
                            supported = supported and (candidate.type == dynamics_type::qss1_integrator or
                              candidate.type == dynamics_type::qss2_integrator or candidate.type == dynamics_type::qss3_integrator);
                        }
                    });
            });
        }
        if (bindings > 1 or not supported)
            return make_error(simulation_errc::state_observer_source_error);
    }
    for (const auto& resource : sim.sims) irt_check(validate_structure(resource.sim));
    return success();
}

template<event_kind K>
status event_dynamics<K>::initialize(simulation& sim) noexcept
{
    for (auto p : reals) if (not std::isfinite(p)) return protocol_error();
    if (integers[3] < 1 or integers[3] > 4096) return protocol_error();
    if constexpr (K == event_kind::numeric)
        if (integers[0] < 0 or integers[0] > 21 or integers[1] < 0 or integers[1] > 3 or
            integers[2] < 0 or integers[2] > 1 or reals[2] < 0) return protocol_error();
    if constexpr (K == event_kind::filter)
        if (integers[0] < 1 or integers[0] > 15) return protocol_error();
    if constexpr (K == event_kind::select)
        if (integers[0] < 0 or integers[0] > 1 or integers[1] < 0 or integers[1] > 1 or
            integers[2] < 0 or integers[2] > 1 or
            (reals[1] != 0 and reals[1] != 1) or (reals[2] != 0 and reals[2] != 1)) return protocol_error();
    if constexpr (K == event_kind::aggregate)
        if (integers[0] < 0 or integers[0] > 4) return protocol_error();
    if constexpr (K == event_kind::group)
        if (integers[0] < 0 or integers[0] > 6 or integers[1] < 0 or integers[1] > 1 or
            integers[2] < 0 or integers[2] > 15 or (reals[0] != 0 and reals[0] != 1)) return protocol_error();
    if constexpr (K == event_kind::tag)
        if (not event_identifier(reals[0]) or not event_identifier(reals[1]) or integers[0] < 0 or integers[0] > 1) return protocol_error();
    if (not sim.event_states.data.reserve(sim.event_states.size() + 1)) return capacity_error();
    sim.event_states.set(sim.get_id(*this), event_state{});
    auto& s = *sim.event_states.get(sim.get_id(*this));
    if constexpr (K == event_kind::state_observer) {
        // The ordinary graph edge into source binds exactly one integrator.
        // Notifications on this port are ignored: they are quantized outputs,
        // not an observation of its current continuous state.
        const auto self = sim.get_id(*this);
        sz bindings = 0;
        bool supported = true;
        for (auto& candidate : sim.models) {
            dispatch(candidate, [&]<typename D>(D& dyn) {
                if constexpr (has_output_port<D>) {
                    for (auto port : dyn.y) if (auto* y = sim.output_ports.try_to_get(port)) {
                        sim.for_each(*y, [&](const model& dst, int input) {
                            if (sim.models.get_id(dst) == self and input == 0) {
                                ++bindings;
                                s.source = sim.models.get_id(candidate);
                                supported = supported and (candidate.type == dynamics_type::qss1_integrator or
                                  candidate.type == dynamics_type::qss2_integrator or candidate.type == dynamics_type::qss3_integrator);
                            }
                        });
                    }
                }
            });
        }
        if (bindings > 1 or not supported) return protocol_error();
    }
    if constexpr (K == event_kind::memory) {
        auto* r = row(s, message{ reals[0], 0, 0 }, sz(integers[3]), reals[0], 0, 1);
        if (not r) return capacity_error();
        r->mask = 1;
    }
    value = K == event_kind::memory ? reals[0] : 0;
    sigma = time_domain<time>::infinity;
    emitted = false;
    return success();
}

template<event_kind K>
status event_dynamics<K>::transition(simulation& sim, time t, time, time) noexcept
{
    auto* storage = sim.event_states.get(sim.get_id(*this));
    if (not storage) return protocol_error();
    auto& s = *storage;
    const auto capacity = sz(integers[3]);
    if (emitted) {
        const auto& sent = s.pending.front();
        if constexpr (K != event_kind::tag and K != event_kind::memory and K != event_kind::state_observer) {
            const bool closed = sent.port == (K == event_kind::select or K == event_kind::priority ? 6 : 2);
            if (closed) {
                const auto campaign = sent.value[2];
                s.rows.erase(std::remove_if(s.rows.begin(), s.rows.end(), [campaign](const auto& r) { return r.campaign == campaign; }), s.rows.end());
                s.barriers.erase(std::remove_if(s.barriers.begin(), s.barriers.end(), [campaign](const auto& b) { return b.campaign == campaign; }), s.barriers.end());
                if constexpr (K == event_kind::group)
                    s.groups.erase(std::remove_if(s.groups.begin(), s.groups.end(), [campaign](const auto& r) { return r.campaign == campaign; }), s.groups.end());
            }
        }
        s.pending.erase(s.pending.begin()); emitted = false;
    }
    if constexpr (K != event_kind::tag) {
        constexpr int reset_port = K == event_kind::select ? 3 : K == event_kind::filter ? 4 : inputs - 1;
        if (not get_message(sim, x[reset_port]).empty()) {
            s.rows.clear(); s.barriers.clear(); s.pending.clear(); s.reads.clear();
            s.groups.clear(); s.closed.clear();
            if constexpr (K == event_kind::state_observer) value = 0;
            if constexpr (K == event_kind::memory) {
                auto* r = row(s, message{ reals[0], 0, 0 }, capacity, reals[0], 0, 1);
                if (not r) return capacity_error();
                r->mask = 1;
                value = reals[0];
            }
        }
    }
    if constexpr (K == event_kind::tag) {
        for (const auto& m : get_message(sim, x[1])) { if (not event_identifier(m[0])) return protocol_error(); reals[0] = m[0]; }
        for (const auto& m : get_message(sim, x[2])) { if (not event_identifier(m[0])) return protocol_error(); reals[1] = m[0]; }
        for (const auto& m : get_message(sim, x[0])) {
            if (integers[0] and not event_identifier(m[2])) return protocol_error();
            irt_check(emit(s, 0, m[0], reals[0], integers[0] ? m[2] : reals[1])); value = std::isfinite(m[0]) ? m[0] : value;
        }
    } else if constexpr (K == event_kind::state_observer) {
        // One internal transition after the read bag: concurrent source
        // transitions from that bag have completed, independent of model order.
        real current = std::numeric_limits<real>::quiet_NaN();
        if (not s.reads.empty()) if (const auto* source = sim.models.try_to_get(s.source)) {
            current = dispatch(*source, [t, source]<typename D>(const D& dyn) -> real {
                if constexpr (std::is_same_v<D, qss1_integrator> or std::is_same_v<D, qss2_integrator> or std::is_same_v<D, qss3_integrator>)
                    return dyn.observation(t, t - source->tl).value;
                else return std::numeric_limits<real>::quiet_NaN();
            });
        }
        for (const auto& read : s.reads) {
            const bool valid = std::isfinite(current);
            irt_check(emit(s, valid ? 0 : 1, valid ? current : 0, read[1], read[2]));
            if (valid) value = current;
        }
        s.reads.clear();
        for (const auto& read : get_message(sim, x[1])) {
            if (not tagged(read)) return protocol_error();
            if (s.reads.size() + s.pending.size() >= capacity or not s.reads.reserve(s.reads.size() + 1)) return capacity_error();
            s.reads.push_back(read);
        }
    } else if constexpr (K == event_kind::memory) {
        // Reset, writes, then reads. Confluent reads see the new value.
        for (const auto& m : get_message(sim, x[0])) {
            if (not tagged(m)) return protocol_error();
            if (not std::isfinite(m[0])) { irt_check(emit(s, 1, 0, m[1], m[2])); continue; }
            auto* r = row(s, m, capacity, reals[0], 0, 1);
            if (not r) return capacity_error();
            r->a = m[0]; r->mask = 1; value = m[0];
            if (integers[0]) irt_check(emit(s, 0, r->a, r->key, r->campaign));
        }
        for (const auto& m : get_message(sim, x[1])) {
            if (not tagged(m)) return protocol_error();
            const event_row* found = nullptr;
            for (const auto& r : s.rows) if (r.key == m[1] and r.campaign == m[2]) { found = &r; break; }
            irt_check(emit(s, found ? 0 : 1, found ? found->a : 0, m[1], m[2]));
        }
    } else if constexpr (K == event_kind::group) {
        irt_check(group_transition(sim, *this, s, capacity));
    } else if constexpr (K == event_kind::aggregate or K == event_kind::broadcast or K == event_kind::priority) {
        irt_check(campaign_transition(sim, *this, s, capacity));
    } else {
        constexpr int data_inputs = K == event_kind::filter ? 4 : K == event_kind::select ? 3 : 2;
        for (int field = 0; field < data_inputs; ++field) {
          const int port = K == event_kind::filter and field == 3 ? 5 : K == event_kind::select and field == 2 ? 4 : field;
          for (const auto& m : get_message(sim, x[port])) {
            if (not tagged(m)) return protocol_error();
            for (const auto& b : s.barriers) if (b.campaign == m[2] and b.sent) return protocol_error();
            auto* r = row(s, m, capacity, K == event_kind::numeric ? reals[0] : 0,
                          K == event_kind::numeric ? reals[1] : reals[0], reals[1]);
            if (not r) return capacity_error();
            (field == 0 ? r->a : field == 1 ? r->b : K == event_kind::select or field == 3 ? r->secondary : r->condition) = m[0];
            r->mask |= 1u << field; r->dirty = true;
          }
        }
        if constexpr (K == event_kind::numeric) {
            for (const auto& m : get_message(sim, x[2])) {
                if (not tagged(m)) return protocol_error();
                auto* r = row(s, m, capacity, reals[0], reals[1], 1);
                if (not r) return capacity_error();
                r->dirty = true;
            }
            const auto trigger = not get_message(sim, x[2]).empty();
            for (auto& r : s.rows) if (r.dirty and (integers[2] or trigger) and (r.mask & integers[1]) == unsigned(integers[1])) {
                // In command mode only the requested identity is evaluated.
                if (not integers[2]) {
                    bool requested = false;
                    for (const auto& m : get_message(sim, x[2])) if (m[1] == r.key and m[2] == r.campaign) requested = true;
                    if (not requested) continue;
                }
                const auto result = calculate(integers[0], r.a, r.b, reals[2], reals[0]);
                r.accepted = std::isfinite(result); r.processed = true; r.dirty = false;
                irt_check(emit(s, r.accepted ? 0 : 1, r.accepted ? result : 0, r.key, r.campaign));
                if (r.accepted) value = result;
            }
        }
        if constexpr (K == event_kind::filter) {
            const auto required = unsigned(integers[0]) | 1u; // a score is always required
            for (auto& r : s.rows) if (r.dirty and (r.mask & required) == required) {
                r.accepted = std::isfinite(r.a) and std::isfinite(r.b) and std::isfinite(r.condition) and r.condition != 0 and
                    (not (required & 8) or std::isfinite(r.secondary));
                r.processed = true; r.dirty = false;
            }
        }
        constexpr int end_port = K == event_kind::select ? 2 : 3;
        for (const auto& m : get_message(sim, x[end_port])) irt_check(barrier(s, m, capacity));
        for (auto& b : s.barriers) if (not b.sent) {
            sz received = 0, ready = 0, accepted = 0;
            event_row* best = nullptr;
            for (auto& r : s.rows) if (r.campaign == b.campaign and (r.mask & 1)) {
                ++received;
                if constexpr (K == event_kind::select) {
                    if (integers[1] and not (r.mask & 2)) continue;
                    if (reals[1] and not (r.mask & 4)) continue;
                    ++ready;
                    if (not std::isfinite(r.a) or not std::isfinite(r.b) or (reals[1] and not std::isfinite(r.secondary))) continue;
                    const bool better = best and (integers[0] ? r.a < best->a : r.a > best->a);
                    const bool tied = best and r.a == best->a;
                    const bool better_secondary = tied and reals[1] and (reals[2] ? r.secondary < best->secondary : r.secondary > best->secondary);
                    const bool same_secondary = not reals[1] or (best and r.secondary == best->secondary);
                    if (not best or better or better_secondary or (tied and same_secondary and r.key < best->key)) best = &r;
                } else if (r.processed) { ++ready; if (r.accepted) ++accepted; }
            }
            if (received > b.expected) return protocol_error();
            if (received != b.expected or ready != received) continue;
            if constexpr (K == event_kind::select) {
                const auto action = best ? best->b : reals[0];
                const auto id = best ? best->key : -1;
                if (best or integers[2])
                    irt_check(emit(s, 0, action, 0, 0)); // ordinary scalar DEVS action
                irt_check(emit(s, 1, id, id, b.campaign));
                irt_check(emit(s, 2, best ? best->a : 0, id, b.campaign));
                if (best) {
                    irt_check(emit(s, 4, best->b, id, b.campaign));
                    irt_check(emit(s, 5, best->secondary, id, b.campaign));
                }
                irt_check(emit(s, 3, best ? 1 : 0, 0, b.campaign));
                irt_check(emit(s, 6, best ? 1 : 0, 0, b.campaign));
                if (best or integers[2]) value = action;
            } else {
                if constexpr (K == event_kind::filter) {
                    // Buffer until the cohort closes: an admissibility update
                    // before end must not leave a stale candidate downstream.
                    for (const auto& r : s.rows) if (r.campaign == b.campaign and (r.mask & 1)) {
                        if (r.accepted) {
                            irt_check(emit(s, 0, r.a, r.key, r.campaign));
                            irt_check(emit(s, 1, r.b, r.key, r.campaign));
                            if (integers[0] & 8) irt_check(emit(s, 4, r.secondary, r.key, r.campaign));
                            value = r.a;
                        } else irt_check(emit(s, 3, 0, r.key, r.campaign));
                    }
                }
                irt_check(emit(s, 2, real(accepted), 0, b.campaign));
            }
            b.sent = true;
        }
    }
    sigma = s.pending.empty() and s.reads.empty() ? time_domain<time>::infinity : zero;
    return success();
}

template<event_kind K>
status event_dynamics<K>::lambda(simulation& sim) noexcept
{
    auto* s = sim.event_states.get(sim.get_id(*this));
    if (not s) return protocol_error();
    // A native output port contains one message, not a bag. Drain the FIFO
    // through zero-time internal transitions so no message is overwritten.
    if (not s->pending.empty()) {
        const auto& item = s->pending.front();
        irt_check(send_message(sim, y[item.port], item.value[0], item.value[1], item.value[2]));
        emitted = true;
    }
    return success();
}
template struct event_dynamics<event_kind::tag>;
template struct event_dynamics<event_kind::memory>;
template struct event_dynamics<event_kind::numeric>;
template struct event_dynamics<event_kind::filter>;
template struct event_dynamics<event_kind::select>;
template struct event_dynamics<event_kind::aggregate>;
template struct event_dynamics<event_kind::broadcast>;
template struct event_dynamics<event_kind::priority>;
template struct event_dynamics<event_kind::state_observer>;
template struct event_dynamics<event_kind::group>;
} // namespace irt
