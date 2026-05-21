// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#ifndef ORG_VLEPROJECT_IRRITATOR_APP_EXPERIMENT_REQUEST_EDITOR_2024
#define ORG_VLEPROJECT_IRRITATOR_APP_EXPERIMENT_REQUEST_EDITOR_2024

#include <irritator/experiment-request.hpp>

#include <filesystem>
#include <string>

namespace irt {

class application;

class experiment_request_editor
{
public:
    constexpr static inline const char* name = "Experiment Request Editor";

    bool is_open = false;

    experiment_request_editor();

    void show(application& app);
    void reset();

private:
    void show_export_dialog(application& app);
    void show_julia_plan_generation(application& app);
    void update_julia_path_status() noexcept;
    bool export_request_to_path(application&               app,
                                const std::filesystem::path& path);

    experiment_request request_;
    std::string validation_message_;
    std::filesystem::path last_export_path_;

    // Champs temporaires utilises pour ajouter de nouvelles lignes.
    char   fixed_parameter_name_[64] = {};
    double fixed_parameter_value_    = 0.0;

    char   variable_parameter_name_[64]         = {};
    char   variable_parameter_distribution_[64] = {};
    double variable_parameter_min_              = 0.0;
    double variable_parameter_max_              = 0.0;

    char   initial_state_name_[64] = {};
    double initial_state_value_    = 0.0;

    char state_variable_name_[64] = {};
    char output_name_[64]         = {};

    bool export_dialog_requested_ = false;
    bool validation_is_valid_     = false;

    std::string julia_executable_;
    std::string julia_script_path_;
    std::string julia_request_json_path_;
    std::string julia_plan_json_path_;
    std::string julia_generation_message_;
    std::string last_julia_command_;
    std::string last_julia_raw_command_;
    std::string last_julia_system_command_;
    int         last_julia_exit_code_ = 0;
    bool        has_last_julia_exit_code_ = false;
    int         last_julia_test_exit_code_ = 0;
    bool        has_last_julia_test_exit_code_ = false;
    bool        last_julia_test_succeeded_ = false;
    bool        julia_executable_exists_ = false;
    bool        julia_script_exists_ = false;
    bool        julia_request_json_exists_ = false;
    bool        julia_plan_json_exists_ = false;
};

} // namespace irt

#endif
