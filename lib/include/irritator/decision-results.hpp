// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#ifndef ORG_VLEPROJECT_IRRITATOR_DECISION_RESULTS_2024
#define ORG_VLEPROJECT_IRRITATOR_DECISION_RESULTS_2024

#include <irritator/error.hpp>

#include <filesystem>
#include <string>
#include <vector>

namespace irt {

struct decision_best_value {
    std::string experiment_id;
    double      value = 0.0;
};

struct decision_global_statistics {
    double mean_final_B          = 0.0;
    double mean_cumulative_catch = 0.0;

    double min_final_B = 0.0;
    double max_final_B = 0.0;
};

struct decision_analysis {
    int experiment_count = 0;

    decision_best_value best_final_B;
    decision_best_value best_cumulative_catch;

    decision_global_statistics global_statistics;
};

struct decision_ranking_entry {
    int rank = 0;

    std::string experiment_id;

    double score = 0.0;

    double final_B          = 0.0;
    double cumulative_catch = 0.0;
};

struct decision_results {
    std::string request_id;
    std::string plan_id;

    decision_analysis analysis;

    std::vector<decision_ranking_entry> ranking;
};

[[nodiscard]] expected<decision_results> read_decision_results_json(
  const std::filesystem::path& path) noexcept;

[[nodiscard]] bool is_valid(const decision_results& results) noexcept;

[[nodiscard]] std::string validation_report(const decision_results& results);

[[nodiscard]] const decision_ranking_entry* best_ranked_experiment(
  const decision_results& results) noexcept;

} // namespace irt

#endif
