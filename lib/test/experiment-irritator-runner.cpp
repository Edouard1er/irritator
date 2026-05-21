// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#include <irritator/modeling.hpp>
#include <irritator/observation.hpp>

#include <boost/ut.hpp>

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <string>
#include <vector>

namespace {

constexpr auto model_path =
  R"(C:\Users\cedouard\AppData\Local\irritator-0.1\components\eddy\ExponentialGrowth.irt)";

struct trajectory {
    std::vector<double> times;
    std::vector<double> values;
};

irt::expected<irt::component_id> load_component_from_file(
  irt::modeling&                mod,
  const std::filesystem::path& path) noexcept
{
    return mod.ids.write(
      [&](irt::component_access& ids) noexcept
        -> irt::expected<irt::component_id> {
          if (not ids.can_alloc_generic_component(1))
              return irt::new_error(irt::modeling_errc::memory_error);

          const auto component_id = ids.alloc_generic_component();
          if (not irt::is_defined(component_id))
              return irt::new_error(irt::modeling_errc::memory_error);

          const auto status = mod.files.read(
            [&](const irt::file_access& files, auto) noexcept -> irt::status {
                return mod.load_component(files, ids, path, component_id);
            });

          if (status.has_error())
              return status.error();

          return component_id;
      });
}

irt::expected<irt::observer_id> attach_observer(irt::project& pj,
                                               const irt::model_id model_id,
                                               const double dt) noexcept
{
    auto* model = pj.sim.models.try_to_get(model_id);
    if (not model)
        return irt::new_error(irt::simulation_errc::models);

    if (not pj.sim.observers.can_alloc() and
        not pj.sim.observers.grow<3, 2>())
        return irt::new_error(irt::simulation_errc::observers_container_full);

    auto& observer = pj.sim.observers.alloc();

    // Le dt du test est un pas d'echantillonnage, pas un pas d'integration QSS.
    observer.init(irt::observer::buffer_size_t{ 64 },
                  irt::observer::linearized_buffer_size_t{ 32768 },
                  static_cast<float>(dt));

    pj.sim.observe(*model, observer);

    return pj.sim.observers.get_id(observer);
}

void write_pending_observations(irt::simulation& sim,
                                const irt::observer_id observer_id,
                                const double dt,
                                trajectory& output)
{
    auto* observer = sim.observers.try_to_get(observer_id);
    if (not observer)
        return;

    if (observer->states[irt::observer_flags::buffer_full]) {
        irt::write_interpolate_data(
          *observer, dt, [&](const auto time, const auto value) {
              output.times.push_back(static_cast<double>(time));
              output.values.push_back(static_cast<double>(value));
          });
    }
}

void flush_observations(irt::simulation& sim,
                        const irt::observer_id observer_id,
                        const double dt,
                        trajectory& output)
{
    auto* observer = sim.observers.try_to_get(observer_id);
    if (not observer)
        return;

    irt::flush_interpolate_data(
      *observer, dt, [&](const auto time, const auto value) {
          output.times.push_back(static_cast<double>(time));
          output.values.push_back(static_cast<double>(value));
      });
}

bool all_finite(const std::vector<double>& values) noexcept
{
    return std::ranges::all_of(values, [](const double value) noexcept {
        return std::isfinite(value);
    });
}

bool is_globally_increasing(const std::vector<double>& values,
                            const double tolerance) noexcept
{
    if (values.size() < 2u)
        return true;

    for (std::size_t i = 1u; i < values.size(); ++i)
        if (values[i] + tolerance < values[i - 1u])
            return false;

    return true;
}

bool times_are_ordered(const std::vector<double>& times,
                       const double tolerance) noexcept
{
    if (times.size() < 2u)
        return true;

    for (std::size_t i = 1u; i < times.size(); ++i)
        if (times[i] + tolerance < times[i - 1u])
            return false;

    return true;
}

} // namespace

int main()
{
    using namespace boost::ut;

    "experiment-irritator-runner-exponential-growth"_test = [] {
        const auto path = std::filesystem::path{ model_path };

        if (not std::filesystem::exists(path)) {
            boost::ut::log << "Modele .irt introuvable: " << path.string()
                           << '\n';
            expect(false >> fatal);
        }

        irt::journal_handler journal;
        irt::modeling        mod{ journal };

        const auto component = load_component_from_file(mod, path);
        if (component.has_error()) {
            boost::ut::log << "Chargement du composant .irt impossible. "
                           << "Categorie: "
                           << static_cast<int>(component.error().cat())
                           << ", code: " << component.error().value() << '\n';
            expect(false >> fatal);
        }

        irt::project pj;
        const auto   project_status = pj.set(mod, component.value());
        if (project_status.has_error()) {
            boost::ut::log << "project::set(...) a echoue. Categorie: "
                           << static_cast<int>(project_status.error().cat())
                           << ", code: " << project_status.error().value()
                           << '\n';
            expect(false >> fatal);
        }

        constexpr auto t0    = 0.0;
        constexpr auto tend  = 10.0;
        constexpr auto dt    = 0.1;
        constexpr auto tol   = 1e-6;
        constexpr auto b0    = 100.0;
        constexpr auto b_min = 150.0;
        constexpr auto b_max = 400.0;

        pj.sim.limits.set_bound(t0, tend);

        const auto b_model = pj.get_model_path("B");
        if (not b_model.has_value()) {
            boost::ut::log << "Modele public B introuvable dans le projet.\n";
            expect(false >> fatal);
        }

        const auto observer_id = attach_observer(pj, b_model->second, dt);
        if (observer_id.has_error()) {
            boost::ut::log << "Impossible d'attacher un observer a B. "
                           << "Categorie: "
                           << static_cast<int>(observer_id.error().cat())
                           << ", code: " << observer_id.error().value()
                           << '\n';
            expect(false >> fatal);
        }

        trajectory observed;
        observed.times.reserve(256u);
        observed.values.reserve(256u);

        auto status = pj.sim.srcs.prepare();
        expect(status.has_value() >> fatal);

        status = pj.sim.initialize();
        expect(status.has_value() >> fatal);

        while (not pj.sim.current_time_expired()) {
            status = pj.sim.run();
            expect(status.has_value() >> fatal);
            write_pending_observations(pj.sim, observer_id.value(), dt, observed);
        }

        status = pj.sim.finalize();
        expect(status.has_value() >> fatal);
        flush_observations(pj.sim, observer_id.value(), dt, observed);

        boost::ut::log << "points: " << observed.times.size() << '\n';

        expect((not observed.times.empty()) >> fatal);
        expect(eq(observed.times.size(), observed.values.size()) >> fatal);

        boost::ut::log << "first_time: " << observed.times.front()
                       << ", last_time: " << observed.times.back()
                       << ", first_B: " << observed.values.front()
                       << ", final_B: " << observed.values.back() << '\n';

        expect(all_finite(observed.times));
        expect(all_finite(observed.values));
        expect(times_are_ordered(observed.times, tol));

        expect(std::abs(observed.values.front() - b0) < 1.0);
        expect(observed.values.back() > observed.values.front());
        expect(is_globally_increasing(observed.values, 1e-4));
        expect(observed.times.back() <= tend + tol);
        expect(observed.values.back() > b_min);
        expect(observed.values.back() < b_max);
    };
}
