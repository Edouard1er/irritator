// Included by core.hpp inside namespace irt, before simulation_snapshot.
// Runtime storage is owned by simulation, never by the model's raw byte buffer.
enum class event_kind : u8 { tag, memory, numeric, filter, select };

struct event_row {
    real key = 0, campaign = 0;
    real a = 0, b = 0, condition = 1;
    unsigned mask = 0;
    bool dirty = false, processed = false, accepted = false;
};
struct event_emission { int port; message value; };
struct event_barrier {
    real campaign = 0;
    sz expected = 0;
    bool sent = false;
};
struct event_state {
    vector<event_row> rows;
    vector<event_emission> pending;
    vector<event_barrier> barriers;
};

template<event_kind Kind>
struct event_dynamics {
    static constexpr auto kind = Kind;
    static constexpr int inputs = Kind == event_kind::tag ? 3 :
      Kind == event_kind::memory ? 3 : Kind == event_kind::select ? 4 : 5;
    static constexpr int outputs = Kind == event_kind::tag ? 1 :
      Kind == event_kind::memory ? 2 : Kind == event_kind::numeric ? 3 : 4;
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
