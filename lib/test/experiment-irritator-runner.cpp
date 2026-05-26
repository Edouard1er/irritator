// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#include <irritator/modeling.hpp>
#include <irritator/observation.hpp>
#include <irritator/helpers.hpp>

#include <boost/ut.hpp>

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace {

constexpr auto model_path =
  R"(C:\Users\cedouard\AppData\Local\irritator-0.1\components\eddy\ExponentialGrowth.irt)";

struct trajectory {
    std::vector<double> times;
    std::vector<double> values;
};

struct simulation_case {
    double           initial_B = 100.0;
    double           r         = 0.1;
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

bool is_integrator_type(const irt::dynamics_type type) noexcept
{
    switch (type) {
    case irt::dynamics_type::qss1_integrator:
    case irt::dynamics_type::qss2_integrator:
    case irt::dynamics_type::qss3_integrator:
        return true;

    default:
        return false;
    }
}

irt::expected<irt::model_id> find_model_by_name(irt::project& pj,
                                                irt::modeling& mod,
                                                const irt::component_id head,
                                                const std::string_view name) noexcept
{
    if (const auto public_model = pj.get_model_path(name);
        public_model.has_value())
        return public_model->second;

    const auto* tn = pj.tn_head();
    if (not tn)
        return irt::new_error(irt::modeling_errc::component_not_found);

    // Le fichier de test actuel ne marque pas toujours les constantes comme
    // publiques. Pour ce test d'injection, on utilise le nom d'enfant du
    // composant comme repli, sans modifier le fichier .irt externe.
    return mod.ids.read(
      [&](const irt::component_access& ids,
          auto) noexcept -> irt::expected<irt::model_id> {
          if (not ids.exists(head))
              return irt::new_error(irt::modeling_errc::component_not_found);

          const auto& component = ids.components[head];
          if (component.type != irt::component_type::generic)
              return irt::new_error(irt::modeling_errc::component_type_mismatch);

          const auto* generic =
            ids.generic_components.try_to_get(component.id.generic_id);
          if (not generic)
              return irt::new_error(irt::modeling_errc::component_not_found);

          for (const auto& child : generic->children) {
              if (child.type != irt::child_type::model)
                  continue;

              const auto child_id = generic->children.get_id(child);
              const auto index    = irt::get_index(child_id);

              if (std::cmp_less(index, 0) or
                  std::cmp_greater_equal(index,
                                         generic->children_names.size()) or
                  generic->children_names[index].sv() != name)
                  continue;

              if (std::cmp_greater_equal(index, tn->children.size()) or
                  not tn->children[child_id].is_model())
                  return irt::new_error(
                    irt::modeling_errc::component_not_found);

              return tn->children[child_id].mdl;
          }

          return irt::new_error(irt::modeling_errc::component_not_found);
      });
}

irt::status set_constant_parameter(irt::project& pj,
                                   irt::modeling& mod,
                                   const irt::component_id head,
                                   const std::string_view name,
                                   const double value) noexcept
{
    const auto model_id = find_model_by_name(pj, mod, head, name);
    if (model_id.has_error())
        return model_id.error();

    const auto* model = pj.sim.models.try_to_get(model_id.value());
    if (not model or model->type != irt::dynamics_type::constant)
        return irt::new_error(irt::simulation_errc::models);

    auto& parameter = pj.sim.parameters[model_id.value()];
    const auto offset = parameter.reals[irt::constant_tag::offset];

    parameter.set_constant(static_cast<irt::real>(value), offset);
    return irt::success();
}

irt::status set_integrator_initial_value(irt::project& pj,
                                         irt::modeling& mod,
                                         const irt::component_id head,
                                         const std::string_view name,
                                         const double value) noexcept
{
    const auto model_id = find_model_by_name(pj, mod, head, name);
    if (model_id.has_error())
        return model_id.error();

    const auto* model = pj.sim.models.try_to_get(model_id.value());
    if (not model or not is_integrator_type(model->type))
        return irt::new_error(irt::simulation_errc::models);

    auto& parameter = pj.sim.parameters[model_id.value()];
    const auto dQ = parameter.reals[irt::qss_integrator_tag::dQ];

    parameter.set_integrator(static_cast<irt::real>(value), dQ);
    return irt::success();
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

irt::expected<trajectory> run_and_collect_trajectory(irt::project& pj,
                                                     const irt::model_id model,
                                                     const double t0,
                                                     const double tend,
                                                     const double dt) noexcept
{
    pj.sim.limits.set_bound(t0, tend);

    const auto observer_id = attach_observer(pj, model, dt);
    if (observer_id.has_error())
        return observer_id.error();

    trajectory observed;
    observed.times.reserve(256u);
    observed.values.reserve(256u);

    auto status = pj.sim.srcs.prepare();
    if (status.has_error())
        return status.error();

    status = pj.sim.initialize();
    if (status.has_error())
        return status.error();

    while (not pj.sim.current_time_expired()) {
        status = pj.sim.run();
        if (status.has_error())
            return status.error();

        write_pending_observations(
          pj.sim, observer_id.value(), dt, observed);
    }

    status = pj.sim.finalize();
    if (status.has_error())
        return status.error();

    flush_observations(pj.sim, observer_id.value(), dt, observed);

    return observed;
}

irt::expected<trajectory> run_case(irt::modeling& mod,
                                   const irt::component_id component,
                                   const simulation_case& scenario,
                                   const double t0,
                                   const double tend,
                                   const double dt) noexcept
{
    irt::project pj;
    auto         status = pj.set(mod, component);
    if (status.has_error())
        return status.error();

    status =
      set_integrator_initial_value(pj, mod, component, "B", scenario.initial_B);
    if (status.has_error())
        return status.error();

    status = set_constant_parameter(pj, mod, component, "r", scenario.r);
    if (status.has_error())
        return status.error();

    const auto b_model = find_model_by_name(pj, mod, component, "B");
    if (b_model.has_error())
        return b_model.error();

    return run_and_collect_trajectory(pj, b_model.value(), t0, tend, dt);
}

void log_error(const std::string_view context, const irt::error_code error)
{
    boost::ut::log << context << " Categorie: "
                   << static_cast<int>(error.cat())
                   << ", code: " << error.value() << '\n';
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

        constexpr auto t0    = 0.0;
        constexpr auto tend  = 10.0;
        constexpr auto dt    = 0.1;
        constexpr auto tol   = 1e-6;

        const auto reference =
          run_case(mod, component.value(), { 100.0, 0.1 }, t0, tend, dt);
        if (reference.has_error()) {
            log_error("Simulation reference impossible.", reference.error());
            expect(false >> fatal);
        }

        const auto changed_b0 =
          run_case(mod, component.value(), { 200.0, 0.1 }, t0, tend, dt);
        if (changed_b0.has_error()) {
            log_error("Simulation B0=200 impossible.", changed_b0.error());
            expect(false >> fatal);
        }

        const auto changed_r =
          run_case(mod, component.value(), { 100.0, 0.2 }, t0, tend, dt);
        if (changed_r.has_error()) {
            log_error("Simulation r=0.2 impossible.", changed_r.error());
            expect(false >> fatal);
        }

        const auto changed_b0_and_r =
          run_case(mod, component.value(), { 300.0, 0.3 }, t0, tend, dt);
        if (changed_b0_and_r.has_error()) {
            log_error("Simulation B0=300,r=0.3 impossible.",
                      changed_b0_and_r.error());
            expect(false >> fatal);
        }

        const auto verify = [&](const std::string_view name,
                                const trajectory&      observed,
                                const double           expected_b0) {
            boost::ut::log << name << " points: " << observed.times.size()
                           << '\n';

            expect((not observed.times.empty()) >> fatal);
            expect(eq(observed.times.size(), observed.values.size()) >> fatal);

            boost::ut::log << name << " first_time: "
                           << observed.times.front()
                           << ", last_time: " << observed.times.back()
                           << ", first_B: " << observed.values.front()
                           << ", final_B: " << observed.values.back() << '\n';

            expect(all_finite(observed.times));
            expect(all_finite(observed.values));
            expect(times_are_ordered(observed.times, tol));
            expect(std::abs(observed.values.front() - expected_b0) < 1.0);
            expect(observed.values.back() > observed.values.front());
            expect(is_globally_increasing(observed.values, 1e-4));
            expect(observed.times.back() <= tend + tol);
        };

        verify("reference", reference.value(), 100.0);
        verify("B0=200", changed_b0.value(), 200.0);
        verify("r=0.2", changed_r.value(), 100.0);
        verify("B0=300,r=0.3", changed_b0_and_r.value(), 300.0);

        const auto final_reference      = reference.value().values.back();
        const auto final_changed_b0     = changed_b0.value().values.back();
        const auto final_changed_r      = changed_r.value().values.back();
        const auto final_changed_b0_and_r =
          changed_b0_and_r.value().values.back();

        expect(final_reference > 150.0);
        expect(final_reference < 400.0);
        expect(final_changed_b0 > final_reference);
        expect(final_changed_r > final_reference);
        expect(final_changed_b0_and_r > final_changed_r);

        boost::ut::log << "B_final reference: " << final_reference << '\n';
        boost::ut::log << "B_final B0=200: " << final_changed_b0 << '\n';
        boost::ut::log << "B_final r=0.2: " << final_changed_r << '\n';
        boost::ut::log << "B_final B0=300,r=0.3: "
                       << final_changed_b0_and_r << '\n';
    };
}
