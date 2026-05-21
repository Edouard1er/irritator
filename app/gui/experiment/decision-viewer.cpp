// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#include "experiment/decision-viewer.hpp"

#include "application.hpp"
#include "dialog.hpp"
#include "imgui.h"

#include <irritator/format.hpp>

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <filesystem>
#include <numeric>
#include <string>
#include <utility>
#include <vector>

namespace irt {
namespace {

constexpr auto table_flags =
  ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg | ImGuiTableFlags_Resizable;

constexpr auto scroll_table_flags =
  table_flags | ImGuiTableFlags_ScrollY | ImGuiTableFlags_SizingStretchProp;

void copy_to_buffer(char* buffer, const std::size_t size, const char* value)
  noexcept
{
    if (size == 0)
        return;

    buffer[0] = '\0';

    if (value)
        std::snprintf(buffer, size, "%s", value);
}

template<std::size_t Size>
void copy_to_buffer(char (&buffer)[Size], const char* value) noexcept
{
    copy_to_buffer(buffer, Size, value);
}

bool has_visible_char(const char* value) noexcept
{
    if (not value)
        return false;

    for (auto it = value; *it != '\0'; ++it)
        if (not std::isspace(static_cast<unsigned char>(*it)))
            return true;

    return false;
}

bool contains_text(const std::string& value, const char* filter) noexcept
{
    if (not has_visible_char(filter))
        return true;

    return value.find(filter) != std::string::npos;
}

bool regular_file_exists(const std::filesystem::path& path) noexcept
{
    try {
        std::error_code ec;
        return std::filesystem::is_regular_file(path, ec) and not ec;
    } catch (...) {
        return false;
    }
}

std::vector<int> make_ranking_indices(
  const decision_results& results,
  const char*             filter_experiment_id,
  const bool              sort_by_score_desc,
  const bool              sort_by_final_B_desc,
  const bool              sort_by_cumulative_catch_desc)
{
    std::vector<int> indices;
    indices.reserve(results.ranking.size());

    for (std::size_t i = 0; i < results.ranking.size(); ++i) {
        if (contains_text(results.ranking[i].experiment_id,
                          filter_experiment_id))
            indices.push_back(static_cast<int>(i));
    }

    if (sort_by_score_desc) {
        std::sort(indices.begin(), indices.end(), [&](const int lhs, const int rhs) {
            return results.ranking[static_cast<std::size_t>(lhs)].score >
                   results.ranking[static_cast<std::size_t>(rhs)].score;
        });
    } else if (sort_by_final_B_desc) {
        std::sort(indices.begin(), indices.end(), [&](const int lhs, const int rhs) {
            return results.ranking[static_cast<std::size_t>(lhs)].final_B >
                   results.ranking[static_cast<std::size_t>(rhs)].final_B;
        });
    } else if (sort_by_cumulative_catch_desc) {
        std::sort(indices.begin(), indices.end(), [&](const int lhs, const int rhs) {
            return results.ranking[static_cast<std::size_t>(lhs)]
                     .cumulative_catch >
                   results.ranking[static_cast<std::size_t>(rhs)]
                     .cumulative_catch;
        });
    }

    return indices;
}

void set_exclusive_sort(bool& selected, bool& other_a, bool& other_b) noexcept
{
    if (selected) {
        other_a = false;
        other_b = false;
    } else if (not other_a and not other_b) {
        selected = true;
    }
}

const char* interpretation_for(const decision_ranking_entry& entry,
                               const decision_results&       results) noexcept
{
    const auto& stats = results.analysis.global_statistics;
    const auto high_biomass = entry.final_B >= stats.mean_final_B;
    const auto high_catch =
      entry.cumulative_catch >= stats.mean_cumulative_catch;

    if (high_biomass and high_catch)
        return "Balanced high-performing strategy";

    if (high_biomass)
        return "High biomass preservation";

    if (high_catch)
        return "High exploitation strategy";

    return "Low relative performance";
}

void show_validation_section(const std::optional<decision_results>& results,
                             bool& results_are_valid,
                             std::string& validation_message)
{
    if (not ImGui::CollapsingHeader("Validation##decision_validation_section",
                                    ImGuiTreeNodeFlags_DefaultOpen))
        return;

    if (not results) {
        ImGui::TextUnformatted("No decision results loaded.");
        return;
    }

    if (ImGui::Button("Validate##decision_validate_button")) {
        results_are_valid  = is_valid(*results);
        validation_message = validation_report(*results);
    }

    const auto valid = is_valid(*results);
    const auto color =
      valid ? ImVec4{ 0.2f, 0.8f, 0.3f, 1.0f }
            : ImVec4{ 0.9f, 0.25f, 0.2f, 1.0f };

    ImGui::SameLine();
    ImGui::TextColored(color, valid ? "VALID" : "INVALID");

    if (validation_message.empty()) {
        results_are_valid  = valid;
        validation_message = validation_report(*results);
    }

    ImGui::TextWrapped("%s", validation_message.c_str());
}

void show_general_information(const decision_results& results)
{
    if (not ImGui::CollapsingHeader(
          "General Information##decision_general_section",
          ImGuiTreeNodeFlags_DefaultOpen))
        return;

    ImGui::Text("request_id: %s", results.request_id.c_str());
    ImGui::Text("plan_id: %s", results.plan_id.c_str());
    ImGui::Text("experiment_count: %d",
                results.analysis.experiment_count);
}

void show_global_statistics(const decision_results& results)
{
    if (not ImGui::CollapsingHeader(
          "Global Statistics##decision_global_stats_section",
          ImGuiTreeNodeFlags_DefaultOpen))
        return;

    const auto& stats = results.analysis.global_statistics;
    ImGui::Text("mean_final_B: %.17g", stats.mean_final_B);
    ImGui::Text("mean_cumulative_catch: %.17g",
                stats.mean_cumulative_catch);
    ImGui::Text("min_final_B: %.17g", stats.min_final_B);
    ImGui::Text("max_final_B: %.17g", stats.max_final_B);
}

void show_best_value(const char* label, const decision_best_value& value)
{
    if (ImGui::TreeNode(label)) {
        ImGui::Text("experiment_id: %s", value.experiment_id.c_str());
        ImGui::Text("value: %.17g", value.value);
        ImGui::TreePop();
    }
}

void show_best_experiments(const decision_results& results)
{
    if (not ImGui::CollapsingHeader(
          "Best Experiments##decision_best_section",
          ImGuiTreeNodeFlags_DefaultOpen))
        return;

    show_best_value("Best final_B##best_final_b_tree",
                    results.analysis.best_final_B);
    show_best_value("Best cumulative_catch##best_catch_tree",
                    results.analysis.best_cumulative_catch);

    if (ImGui::TreeNode("Best ranked experiment##best_ranked_tree")) {
        if (const auto* best = best_ranked_experiment(results)) {
            ImGui::Text("experiment_id: %s", best->experiment_id.c_str());
            ImGui::Text("score: %.17g", best->score);
            ImGui::Text("final_B: %.17g", best->final_B);
            ImGui::Text("cumulative_catch: %.17g",
                        best->cumulative_catch);
        } else {
            ImGui::TextUnformatted("<empty>");
        }

        ImGui::TreePop();
    }
}

void show_ranking_filters(char* filter_experiment_id,
                          const std::size_t filter_size,
                          bool& sort_by_score_desc,
                          bool& sort_by_final_B_desc,
                          bool& sort_by_cumulative_catch_desc)
{
    if (not ImGui::CollapsingHeader(
          "Ranking Filters##decision_ranking_filters_section",
          ImGuiTreeNodeFlags_DefaultOpen))
        return;

    ImGui::SetNextItemWidth(240.0f);
    ImGui::InputText("experiment id contains##decision_filter_experiment_id",
                     filter_experiment_id,
                     filter_size);

    if (ImGui::Checkbox("score descending##decision_sort_score",
                        &sort_by_score_desc))
        set_exclusive_sort(sort_by_score_desc,
                           sort_by_final_B_desc,
                           sort_by_cumulative_catch_desc);

    ImGui::SameLine();

    if (ImGui::Checkbox("final_B descending##decision_sort_final_b",
                        &sort_by_final_B_desc))
        set_exclusive_sort(sort_by_final_B_desc,
                           sort_by_score_desc,
                           sort_by_cumulative_catch_desc);

    ImGui::SameLine();

    if (ImGui::Checkbox(
          "cumulative_catch descending##decision_sort_catch",
          &sort_by_cumulative_catch_desc))
        set_exclusive_sort(sort_by_cumulative_catch_desc,
                           sort_by_score_desc,
                           sort_by_final_B_desc);
}

void show_ranking_overview(const decision_results&     results,
                           const std::vector<int>&     indices,
                           int&                        selected_ranking_index)
{
    if (not ImGui::CollapsingHeader(
          "Ranking Overview##decision_ranking_overview_section",
          ImGuiTreeNodeFlags_DefaultOpen))
        return;

    ImGui::Text("visible ranking entries: %zu / %zu",
                indices.size(),
                results.ranking.size());

    if (ImGui::BeginTable("decision-ranking-overview-table",
                          5,
                          scroll_table_flags,
                          ImVec2{ 0.0f, 300.0f })) {
        ImGui::TableSetupColumn("rank", ImGuiTableColumnFlags_WidthFixed);
        ImGui::TableSetupColumn("experiment_id");
        ImGui::TableSetupColumn("score");
        ImGui::TableSetupColumn("final_B");
        ImGui::TableSetupColumn("cumulative_catch");
        ImGui::TableSetupScrollFreeze(0, 1);
        ImGui::TableHeadersRow();

        ImGuiListClipper clipper;
        clipper.Begin(static_cast<int>(indices.size()));

        while (clipper.Step()) {
            for (int row = clipper.DisplayStart; row < clipper.DisplayEnd;
                 ++row) {
                const auto ranking_index = indices[static_cast<std::size_t>(row)];
                if (ranking_index < 0 or
                    ranking_index >= static_cast<int>(results.ranking.size()))
                    continue;

                const auto& entry =
                  results.ranking[static_cast<std::size_t>(ranking_index)];
                const auto selected = selected_ranking_index == ranking_index;

                ImGui::PushID(ranking_index);
                ImGui::TableNextRow();
                ImGui::TableNextColumn();

                if (ImGui::Selectable(std::to_string(entry.rank).c_str(),
                                      selected,
                                      ImGuiSelectableFlags_SpanAllColumns))
                    selected_ranking_index = ranking_index;

                ImGui::TableNextColumn();
                ImGui::TextUnformatted(entry.experiment_id.c_str());
                ImGui::TableNextColumn();
                ImGui::Text("%.17g", entry.score);
                ImGui::TableNextColumn();
                ImGui::Text("%.17g", entry.final_B);
                ImGui::TableNextColumn();
                ImGui::Text("%.17g", entry.cumulative_catch);
                ImGui::PopID();
            }
        }

        ImGui::EndTable();
    }
}

void show_ranking_details(const decision_results& results,
                          const int selected_ranking_index)
{
    if (not ImGui::CollapsingHeader(
          "Ranking Details##decision_ranking_details_section",
          ImGuiTreeNodeFlags_DefaultOpen))
        return;

    if (selected_ranking_index < 0 or
        selected_ranking_index >= static_cast<int>(results.ranking.size())) {
        ImGui::TextUnformatted("No ranking entry selected.");
        return;
    }

    const auto& entry =
      results.ranking[static_cast<std::size_t>(selected_ranking_index)];

    ImGui::Text("rank: %d", entry.rank);
    ImGui::Text("experiment_id: %s", entry.experiment_id.c_str());
    ImGui::Text("score: %.17g", entry.score);
    ImGui::Text("final_B: %.17g", entry.final_B);
    ImGui::Text("cumulative_catch: %.17g", entry.cumulative_catch);
    ImGui::TextWrapped("Interpretation: %s",
                       interpretation_for(entry, results));
}

void show_decision_interpretation()
{
    if (not ImGui::CollapsingHeader(
          "Decision Interpretation##decision_interpretation_section",
          ImGuiTreeNodeFlags_DefaultOpen))
        return;

    ImGui::TextWrapped(
      "This ranking is a first prototype of A** decision analysis based on "
      "experimental trajectories.");
}

} // namespace

void decision_results_viewer::show(application& app)
{
    ImGui::SetNextWindowDockID(app.get_main_dock_id(), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(760.0f, 720.0f), ImGuiCond_FirstUseEver);

    if (!ImGui::Begin(decision_results_viewer::name, &is_open)) {
        ImGui::End();
        show_load_dialog(app);
        return;
    }

    if (ImGui::CollapsingHeader("Load Decision Results##decision_load_section",
                                ImGuiTreeNodeFlags_DefaultOpen)) {
        ImGui::SetNextItemWidth(-170.0f);
        ImGui::InputText("decision JSON##decision_results_path_input",
                         decision_results_path_,
                         sizeof(decision_results_path_));

        if (ImGui::Button("Load decision_results.json##load_decision_button"))
            load_from_path(app,
                           std::filesystem::path{ decision_results_path_ });

        ImGui::SameLine();

        if (ImGui::Button("Browse...##browse_decision_button")) {
            app.f_dialog.clear();
            load_dialog_requested_ = true;
        }

        if (not loaded_path_.empty()) {
            const auto path = loaded_path_.string();
            ImGui::TextWrapped("Loaded path: %s", path.c_str());
        }

        if (not load_message_.empty())
            ImGui::TextWrapped("%s", load_message_.c_str());
    }

    show_validation_section(loaded_results_,
                            results_are_valid_,
                            validation_message_);

    if (loaded_results_) {
        auto& results = *loaded_results_;

        if (selected_ranking_index_ >= static_cast<int>(results.ranking.size()))
            selected_ranking_index_ = -1;

        show_general_information(results);
        show_global_statistics(results);
        show_best_experiments(results);
        show_ranking_filters(filter_experiment_id_,
                             sizeof(filter_experiment_id_),
                             sort_by_score_desc_,
                             sort_by_final_B_desc_,
                             sort_by_cumulative_catch_desc_);

        const auto indices =
          make_ranking_indices(results,
                               filter_experiment_id_,
                               sort_by_score_desc_,
                               sort_by_final_B_desc_,
                               sort_by_cumulative_catch_desc_);

        show_ranking_overview(results, indices, selected_ranking_index_);
        show_ranking_details(results, selected_ranking_index_);
        show_decision_interpretation();
    } else {
        ImGui::TextUnformatted("No decision results loaded.");
    }

    ImGui::End();

    show_load_dialog(app);
}

void decision_results_viewer::load_from_path(application& app,
                                             const std::filesystem::path& path)
{
    loaded_results_.reset();
    loaded_path_.clear();
    validation_message_.clear();
    results_are_valid_ = false;
    selected_ranking_index_ = -1;

    if (path.empty()) {
        load_message_ = "Decision results path is empty.";
        app.jn.push(log_level::error, [](auto& title, auto& msg) noexcept {
            title = "Decision Results Viewer";
            msg   = "Decision results path is empty";
        });
        return;
    }

    if (not regular_file_exists(path)) {
        load_message_ = "Decision results file does not exist.";
        app.jn.push(log_level::error, [&](auto& title, auto& msg) noexcept {
            title = "Decision Results Viewer";
            format(msg,
                   "Decision results file does not exist: {}",
                   path.string());
        });
        return;
    }

    auto result = read_decision_results_json(path);
    if (result.has_error()) {
        const auto error = result.error();
        load_message_   = "Failed to read decision results JSON.";
        app.jn.push(log_level::error, [&, error](auto& title, auto& msg) noexcept {
            title = "Decision Results Viewer";
            format(msg,
                   "Failed to read decision results JSON {} (category {}, "
                   "code {})",
                   path.string(),
                   static_cast<int>(error.cat()),
                   error.value());
        });
        return;
    }

    loaded_results_     = std::move(result).value();
    loaded_path_        = path;
    results_are_valid_  = is_valid(*loaded_results_);
    validation_message_ = validation_report(*loaded_results_);

    if (not loaded_results_->ranking.empty())
        selected_ranking_index_ = 0;

    load_message_ = results_are_valid_
                      ? "Decision results loaded and valid."
                      : "Decision results loaded but invalid.";

    const auto status = results_are_valid_ ? "valid" : "invalid";
    app.jn.push(log_level::info, [&, status](auto& title, auto& msg) noexcept {
        title = "Decision Results Viewer";
        format(msg,
               "Decision results loaded from {} ({}, {} ranking entries)",
               path.string(),
               status,
               loaded_results_->ranking.size());
    });
}

void decision_results_viewer::show_load_dialog(application& app)
{
    if (not load_dialog_requested_)
        return;

    const char*    title     = "Select decision results JSON";
    const char8_t* filters[] = { u8".json", nullptr };

    ImGui::OpenPopup(title);

    if (app.f_dialog.show_load_file(title, filters)) {
        if (app.f_dialog.state == file_dialog::status::ok) {
            const auto path = app.f_dialog.result;
            copy_to_buffer(decision_results_path_, path.string().c_str());
            load_from_path(app, path);
        }

        app.f_dialog.clear();
        load_dialog_requested_ = false;
    }
}

} // namespace irt
