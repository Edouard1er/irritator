// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#ifndef ORG_VLEPROJECT_IRRITATOR_APP_DECISION_RESULTS_VIEWER_2024
#define ORG_VLEPROJECT_IRRITATOR_APP_DECISION_RESULTS_VIEWER_2024

#include <irritator/decision-results.hpp>

#include <filesystem>
#include <optional>
#include <string>

namespace irt {

class application;

class decision_results_viewer
{
public:
    constexpr static inline const char* name = "Decision Results Viewer";

    bool is_open = false;

    decision_results_viewer() = default;

    void show(application& app);

private:
    void load_from_path(application& app, const std::filesystem::path& path);
    void show_load_dialog(application& app);

    std::optional<irt::decision_results> loaded_results_;

    std::filesystem::path loaded_path_;

    std::string validation_message_;
    std::string load_message_;

    bool results_are_valid_ = false;

    int selected_ranking_index_ = -1;

    char decision_results_path_[512] = "decision_results.json";
    char filter_experiment_id_[128]  = "";

    bool sort_by_score_desc_            = true;
    bool sort_by_final_B_desc_          = false;
    bool sort_by_cumulative_catch_desc_ = false;
    bool load_dialog_requested_         = false;
};

} // namespace irt

#endif
