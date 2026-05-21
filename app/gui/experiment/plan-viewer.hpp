// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#ifndef ORG_VLEPROJECT_IRRITATOR_APP_EXPERIMENT_PLAN_VIEWER_2024
#define ORG_VLEPROJECT_IRRITATOR_APP_EXPERIMENT_PLAN_VIEWER_2024

#include <irritator/experiment-plan.hpp>
#include <irritator/experiment-runner.hpp>

#include <filesystem>
#include <optional>
#include <string>

namespace irt {

class application;

class experiment_plan_viewer
{
public:
    constexpr static inline const char* name = "Experiment Plan Viewer";

    bool is_open = false;

    experiment_plan_viewer() = default;

    void show(application& app);

private:
    void load_from_path(application& app, const std::filesystem::path& path);
    void show_load_dialog(application& app);
    void clear_run_results() noexcept;
    void run_loaded_plan(application& app);
    void export_results_to_path(application& app,
                                const std::filesystem::path& path);
    void show_julia_results_analysis(application& app);
    void analyze_results_with_julia(application& app);

    std::optional<irt::experiment_plan> loaded_plan_;
    std::optional<irt::experiment_run_results> run_results_;

    std::filesystem::path loaded_path_;

    std::string validation_message_;
    std::string load_message_;
    std::string run_message_;
    std::string export_results_message_;
    std::string analysis_message_;

    bool plan_is_valid_ = false;
    bool run_completed_ = false;

    int selected_experiment_index_ = -1;
    int selected_result_index_     = -1;

    char plan_path_[512] = "experiment_plan.json";
    char results_output_path_[512] = "experiment_results.json";
    char julia_analysis_executable_[512] = "julia";
    char julia_analysis_script_[512] =
      "tools/julia/analyze_experiment_results.jl";
    char experiment_results_input_path_[512] = "experiment_results.json";
    char decision_results_output_path_[512] = "decision_results.json";

    char filter_experiment_id_[128] = "";
    char filter_parameter_name_[128] = "";

    double filter_parameter_min_ = 0.0;
    double filter_parameter_max_ = 0.0;

    bool use_parameter_range_filter_ = false;
    bool load_dialog_requested_      = false;

    bool sort_by_cumulative_catch_desc_ = false;
    bool sort_by_final_biomass_desc_    = false;

    double last_run_duration_ms_ = 0.0;
    int last_analysis_exit_code_ = 0;
    std::string last_analysis_command_;
};

} // namespace irt

#endif
