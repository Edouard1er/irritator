// Included by core.hpp inside namespace irt, before simulation_snapshot.
// Runtime storage is owned by simulation, never by the model's raw byte buffer.
enum class event_kind : u8 { tag, memory, numeric, filter, select, aggregate, broadcast, priority, state_observer, group };

struct group_row {
    real scenario = 0, campaign = 0, key = 0, action = 0, value = 0, valid = 1, weight = 1;
    unsigned mask = 0;
};
struct event_closed_range { real first = 0, last = 0; };

struct event_row {
    real key = 0, campaign = 0;
    real a = 0, b = 0, condition = 1;
    unsigned mask = 0;
    bool dirty = false, processed = false, accepted = false;
    real secondary = 0, identity = 0;
};
struct event_emission { int port; message value; };
struct event_barrier {
    real campaign = 0;
    sz expected = 0;
    bool sent = false;
    bool ended = false;
    real aggregate = 0;
    bool has_aggregate = false, aggregate_ended = false;
    sz aggregate_expected = 0;
    bool sealed = false;
    bool waiting_reported = false;
};
struct event_state {
    vector<event_row> rows;
    vector<event_emission> pending;
    vector<event_barrier> barriers;
    // Observation bindings use model IDs, so simulation copies and snapshots
    // remain local to their own model storage. No pointers to live dynamics.
    model_id source = undefined<model_id>();
    vector<message> reads;
    vector<group_row> groups;
    // Compact replay protection: consecutive campaigns coalesce. Sparse
    // closed ranges are bounded by the same explicit capacity as live rows.
    vector<event_closed_range> closed;
};

template<event_kind Kind>
struct event_dynamics {
    static constexpr auto kind = Kind;
    static constexpr int inputs = Kind == event_kind::group ? 8 : Kind == event_kind::tag ? 3 :
      Kind == event_kind::memory or Kind == event_kind::aggregate or Kind == event_kind::state_observer ? 3 :
      Kind == event_kind::select ? 5 : Kind == event_kind::filter ? 6 :
      Kind == event_kind::priority ? 9 : 5;
    static constexpr int outputs = Kind == event_kind::group ? 10 : Kind == event_kind::tag ? 1 :
      Kind == event_kind::memory or Kind == event_kind::state_observer ? 2 : Kind == event_kind::numeric or Kind == event_kind::aggregate ? 3 :
      Kind == event_kind::select or Kind == event_kind::priority ? 7 : Kind == event_kind::filter ? 5 : 4;
    input_port x[inputs] = {};
    output_port_id y[outputs] = {};
    std::array<real, 4> reals{};
    std::array<i64, 4> integers{};
    time sigma = time_domain<time>::infinity;
    real value = 0;
    bool emitted = false;

    event_dynamics() noexcept
    {
        integers[3] = 128; // maximum simultaneous keyed rows / barriers
        if constexpr (Kind == event_kind::numeric) {
            integers[1] = 1; // require a; b may use its configured constant
            integers[2] = 1; // compute on input
        }
        if constexpr (Kind == event_kind::filter) {
            reals[1] = 1; // default admissibility
            integers[0] = 1; // require score
        }
        if constexpr (Kind == event_kind::select) {
            integers[1] = 1; // require associated action
            integers[2] = 1; // preserve the historical explicit fallback mode
        }
        if constexpr (Kind == event_kind::priority) reals[1] = 1;
        if constexpr (Kind == event_kind::group) {
            integers[2] = 11; // require value, validity and action
            reals[0] = 1; // end carries [valid,total,campaign] by default
        }
    }
    status initialize(simulation& sim) noexcept;
    status transition(simulation& sim, time t, time e, time r) noexcept;
    status lambda(simulation& sim) noexcept;
    raw_sample observation(time t, time) const noexcept { return { t, value }; }
};
using event_tag = event_dynamics<event_kind::tag>;
using value_memory = event_dynamics<event_kind::memory>;
using event_operator = event_dynamics<event_kind::numeric>;
using candidate_filter = event_dynamics<event_kind::filter>;
using candidate_select = event_dynamics<event_kind::select>;
using campaign_aggregate = event_dynamics<event_kind::aggregate>;
using campaign_broadcast = event_dynamics<event_kind::broadcast>;
using selection_priority = event_dynamics<event_kind::priority>;
using state_observer = event_dynamics<event_kind::state_observer>;
using group_aggregate = event_dynamics<event_kind::group>;
