// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#ifndef ORG_VLEPROJECT_IRRITATOR_EXPERIMENT_PLAN_2024
#define ORG_VLEPROJECT_IRRITATOR_EXPERIMENT_PLAN_2024

#include <irritator/error.hpp>
#include <irritator/macros.hpp>

#include <filesystem>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace irt {

//! Ligne historique du prototype T*. Conservee pour ne pas casser l'existant.
struct experiment_line {
    i32         id          = 0;
    real        n_candidate = 0.0;
    real        horizon     = 0.0;
    real        B0          = 0.0;
    real        C0          = 0.0;
    real        n0          = 0.0;
    real        r           = 0.0;
    real        K           = 0.0;
    real        q           = 0.0;
    real        a           = 0.0;
    std::string label;
};

[[nodiscard]] inline bool is_valid(const experiment_line& e) noexcept
{
    return e.id >= 0 && e.n_candidate >= 0.0 && e.horizon > 0.0 &&
           e.B0 > 0.0 && e.q > 0.0 && e.K > 0.0;
}

//! Une experience elementaire lue depuis experiment_plan.json.
struct experiment_row {
    std::string id;
    std::map<std::string, double> parameters;
    std::map<std::string, double> initial_states;
};

//! Reglages communs du plan genere par Julia.
struct experiment_plan_simulation_settings {
    double t0      = 0.0;
    double horizon = 0.0;
    double dt      = 0.0;
};

//! Plan Julia -> Irritator. Il decrit quoi simuler, sans executer de simulation.
struct experiment_plan {
    std::string request_id;
    std::string plan_id;
    std::string model_name;

    experiment_plan_simulation_settings simulation;

    std::vector<experiment_row> experiments;

    std::vector<std::string> state_variables_to_record;
    std::vector<std::string> outputs_to_record;

    //! Compatibilite avec le prototype T* precedent.
    std::vector<experiment_line> lines;

    [[nodiscard]] i32 size() const noexcept
    {
        return static_cast<i32>(lines.size());
    }

    [[nodiscard]] bool empty() const noexcept { return lines.empty(); }

    void push(experiment_line e) { lines.push_back(std::move(e)); }

    void clear() noexcept
    {
        request_id.clear();
        plan_id.clear();
        model_name.clear();
        simulation = {};
        experiments.clear();
        state_variables_to_record.clear();
        outputs_to_record.clear();
        lines.clear();
    }
};

[[nodiscard]] expected<experiment_plan> read_experiment_plan_json(
  const std::filesystem::path& path) noexcept;

[[nodiscard]] bool is_valid(const experiment_plan& plan) noexcept;

[[nodiscard]] std::string validation_report(const experiment_plan& plan);

//! Conserve le petit plan factoriel du prototype T* initial.
[[nodiscard]] inline experiment_plan make_simple_fishing_experiment_plan(
  real B0,
  real C0,
  real horizon)
{
    constexpr real n_values[] = { 80.0, 150.0, 260.0 };
    constexpr real q_values[] = { 0.0008, 0.0010 };

    constexpr real r_default = 0.3;
    constexpr real K_default = 300.0;
    constexpr real a_default = 1.0;

    experiment_plan plan;
    i32             id = 0;

    for (const real n : n_values) {
        for (const real q : q_values) {
            experiment_line line{};
            line.id          = id++;
            line.n_candidate = n;
            line.horizon     = horizon;
            line.B0          = B0;
            line.C0          = C0;
            line.n0          = n;
            line.r           = r_default;
            line.K           = K_default;
            line.q           = q;
            line.a           = a_default;
            plan.push(std::move(line));
        }
    }

    return plan;
}

} // namespace irt

#endif
