// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#ifndef ORG_VLEPROJECT_IRRITATOR_EXPERIMENT_RUNNER_2024
#define ORG_VLEPROJECT_IRRITATOR_EXPERIMENT_RUNNER_2024

#include <irritator/error.hpp>
#include <irritator/experiment-plan.hpp>

#include <filesystem>
#include <string>
#include <vector>

namespace irt {

enum class experiment_runner_errc : std::int16_t {
    invalid_simulation = 1,
    missing_parameter,
    missing_initial_state,
    invalid_value,
    numerical_error,
    file_error,
};

struct trajectory {
    std::vector<double> time;
    std::vector<double> values;
};

struct experiment_result_summary {
    double final_B          = 0.0;
    double min_B            = 0.0;
    double max_B            = 0.0;
    double mean_B           = 0.0;
    double cumulative_catch = 0.0;
};

struct experiment_result {
    std::string experiment_id;

    trajectory biomass_trajectory;
    trajectory catch_trajectory;

    experiment_result_summary summary;
};

struct experiment_run_results {
    std::string request_id;
    std::string plan_id;

    std::vector<experiment_result> results;
};

[[nodiscard]] expected<experiment_result> run_schaefer_experiment(
  const experiment_row&                      row,
  const experiment_plan_simulation_settings& simulation) noexcept;

[[nodiscard]] expected<experiment_run_results> run_experiment_plan(
  const experiment_plan& plan) noexcept;

[[nodiscard]] status write_experiment_results_json(
  const std::filesystem::path&     path,
  const experiment_run_results&    results) noexcept;

} // namespace irt

#endif
