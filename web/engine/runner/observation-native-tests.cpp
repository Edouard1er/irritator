// Minimal native reproduction of the 8E coarse-sampling abort. No runner,
// JSON, scheduler, Schaefer equation or child simulation is needed.
#include <irritator/core.hpp>
#include <cmath>
#include <iostream>
#include <vector>

int main()
{
    bool success = true;
    for (const double dt : {0.1, 0.25, 0.5, 1., 2.}) {
        irt::observer obs(irt::undefined<irt::model_id>());
        irt::resampler sampler(dt, irt::interpolate_type::qss3);
        // The last sealed native value differs from quadratic extrapolation.
        obs.observe({0., 0., 1., 0.});
        sampler.tick(obs, 0.5);
        obs.observe({2., 2.5, 2., 0.});
        sampler.tick(obs, 2.); // This date is still unsealed.
        obs.observe({2., 3., 2., 0.}); // Last native state at that date wins.
        sampler.tick(obs, std::numeric_limits<double>::infinity());
        bool ordered = true;
        obs.read_history([&](const auto& history, auto) {
            double previous = -1.;
            for (const auto& p : history) {
                std::cout << "SAMPLE " << dt << ' ' << p.t << ' ' << p.value << '\n';
                ordered &= std::isfinite(p.value) && p.t > previous;
                if (p.t < 2.) ordered &= std::abs(p.value - p.t) < 1e-12;
                previous = p.t;
            }
            ordered &= !history.empty() && history.back().t == 2. && history.back().value == 3.;
        });
        std::size_t count = 0;
        obs.read_history([&](const auto& history, auto) { count = history.size(); });
        sampler.tick(obs, std::numeric_limits<double>::infinity());
        obs.read_history([&](const auto& history, auto) { ordered &= history.size() == count; });
        if (!ordered) { std::cerr << "UNORDERED_NATIVE_HISTORY dt=" << dt << '\n'; success = false; }
    }
    if (success) std::cout << "NATIVE_OBSERVATION_PASS\n";
    return success ? 0 : 1;
}
