// Test-only obstruction witness for Test 8P clause 7. No proposed probe
// implementation and no production simulation/dynamics changes are hidden here.
#include <irritator/core.hpp>
#include <array>
#include <cmath>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string_view>
#include <vector>

namespace {
void require(bool condition, const char* what)
{
    if (!condition) throw std::runtime_error(what);
}
void checked(irt::status result)
{
    require(!result.has_error(), "unexpected native engine error");
}
struct emission { irt::time date; irt::message value; };

// The most favorable possible request-only transition: preserves every bit of
// QSS physical state and its absolute deadline; asks the generic coordinator to
// wake at the residual duration. No allocation, lambda, model lookup or reads of
// another atom. The public coordinator template permits this white-box witness.
struct passive_probe_witness {
    irt::time deadline;
    irt::time sigma = 0;
    irt::status transition(irt::simulation&, irt::time t, irt::time, irt::time) noexcept
    {
        sigma = deadline - t;
        return irt::success();
    }
};

template<int Order>
std::vector<emission> run(bool probe)
{
    irt::simulation sim;
    auto& qss = sim.alloc<irt::abstract_integrator<Order>>();
    const auto id = sim.get_id(qss);
    const auto deadline = std::nextafter(1.0, 2.0);
    sim.parameters[id].set_integrator(0, deadline);
    auto& derivative = sim.alloc<irt::constant>();
    sim.parameters[sim.get_id(derivative)].set_constant(1, 0);
    auto& sink = sim.alloc<irt::counter>();
    checked(sim.connect(irt::get_model(derivative), 0, irt::get_model(qss), 0));
    checked(sim.connect(irt::get_model(qss), 0, irt::get_model(sink), 0));
    sim.limits.set_bound(0, 1.5);
    checked(sim.initialize());

    int steps = 0;
    while (sim.sched.tn() == 0) {
        require(++steps < 32, "initialization livelock");
        checked(sim.run());
    }
    auto& model = sim.models.get(id);
    require(model.tn == deadline && qss.sigma == deadline,
            "fixture did not produce the exact QSS deadline");

    if (probe) {
        const auto t = std::ldexp(1.0, -53);
        std::array<std::byte, sizeof(qss)> old_state;
        std::memcpy(old_state.data(), &qss, sizeof(qss));
        // Emulate delivery of a new external request to this atom at t using
        // the real scheduler and the real make_transition, without modifying
        // the QSS algorithm or introducing a purported implementation.
        sim.current_time(t);
        sim.sched.update(model, t);
        sim.immediate_models.clear();
        sim.sched.pop(sim.immediate_models);
        require(sim.immediate_models.size() == 1 && sim.immediate_models[0] == id,
                "witness popped an unexpected model");
        passive_probe_witness witness{deadline};
        checked(sim.make_transition(model, witness, t));
        require(std::memcmp(old_state.data(), &qss, sizeof(qss)) == 0,
                "witness modified physical state");
        std::cout << "physical state preserved exactly; original tn=" << deadline
                  << "; probe t=" << t << "; rescheduled tn=" << model.tn << '\n';
    }

    std::vector<emission> result;
    while (!sim.current_time_expired()) {
        require(++steps < 64, "simulation livelock");
        checked(sim.run());
        if (sim.current_time_expired()) break;
        for (const auto port : sim.active_output_ports)
            if (port == qss.y[0]) result.push_back({sim.current_time(), sim.output_ports.get(port).msg});
    }
    checked(sim.finalize());
    return result;
}
} // namespace

int main(int argc, char** argv)
{
    try {
        std::cout << std::setprecision(17);
        const auto d = std::nextafter(1.0, 2.0), t = std::ldexp(1.0, -53);
        const auto residual = d - t;
        const auto below = std::nextafter(residual, 0.0);
        const auto above = std::nextafter(residual, 2.0);
        std::cout << "IEEE binary64: deadline=" << d << "; t=" << t
                  << "; residual=" << residual << "; t+residual=" << t + residual
                  << "; t+nextdown=" << t + below << "; t+nextup=" << t + above << '\n';
        // Monotonicity proves that no binary64 sigma can recover d: these
        // adjacent representable residuals straddle it without producing it.
        require(above == d && t + residual < d && t + above > d,
                "unsupported floating point environment for witness");
        bool exact = true;
        const auto check = [&]<int Order>() {
            const auto base = run<Order>(false), observed = run<Order>(true);
            require(base.size() == 1 && observed.size() == 1, "unexpected multiplicity");
            require(base[0].value == observed[0].value, "unexpected value perturbation");
            const bool equal = base[0].date == observed[0].date;
            exact = exact && equal;
            std::cout << "native QSS" << Order << " y0: baseline t=" << base[0].date
                      << "; witness t=" << observed[0].date
                      << "; baseline value=" << base[0].value[0]
                      << "; witness value=" << observed[0].value[0]
                      << "; multiplicity=1/1; exact dates=" << equal << '\n';
        };
        check.template operator()<1>();
        check.template operator()<2>();
        check.template operator()<3>();
        if (argc > 1 && std::string_view(argv[1]) == "--require-exact") return exact ? 0 : 1;
        require(!exact, "obstruction no longer reproduced: revisit clause 7 report");
        std::cout << "Obstruction reproduced; this does not certify state_observer.\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << e.what() << '\n';
        return 2;
    }
}
