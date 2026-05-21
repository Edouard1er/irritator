// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#include "experiment/plan-viewer.hpp"

#include "application.hpp"
#include "dialog.hpp"
#include "imgui.h"

#include <irritator/format.hpp>

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <limits>
#include <map>
#include <set>
#include <string>
#include <string_view>
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

struct parameter_stat {
    int    count = 0;
    double first = 0.0;
    double min   = std::numeric_limits<double>::max();
    double max   = std::numeric_limits<double>::lowest();
    double sum   = 0.0;
    bool   fixed = true;

    void add(const double value) noexcept
    {
        if (count == 0) {
            first = value;
            min   = value;
            max   = value;
        } else {
            if (value != first)
                fixed = false;

            min = std::min(min, value);
            max = std::max(max, value);
        }

        sum += value;
        ++count;
    }

    double mean() const noexcept
    {
        return count > 0 ? sum / static_cast<double>(count) : 0.0;
    }
};

struct plan_statistics {
    std::set<std::string> parameters;
    std::set<std::string> initial_states;
    std::map<std::string, parameter_stat> parameter_stats;
    double average_parameter_count     = 0.0;
    double average_initial_state_count = 0.0;
};

plan_statistics compute_statistics(const experiment_plan& plan)
{
    plan_statistics stats;

    if (plan.experiments.empty())
        return stats;

    std::size_t parameter_count     = 0u;
    std::size_t initial_state_count = 0u;

    for (const auto& experiment : plan.experiments) {
        parameter_count += experiment.parameters.size();
        initial_state_count += experiment.initial_states.size();

        for (const auto& [name, value] : experiment.parameters) {
            stats.parameters.emplace(name);
            stats.parameter_stats[name].add(value);
        }

        for (const auto& [name, _] : experiment.initial_states) {
            (void)_;
            stats.initial_states.emplace(name);
        }
    }

    const auto experiments_count =
      static_cast<double>(plan.experiments.size());
    stats.average_parameter_count =
      static_cast<double>(parameter_count) / experiments_count;
    stats.average_initial_state_count =
      static_cast<double>(initial_state_count) / experiments_count;

    for (auto& [_, stat] : stats.parameter_stats) {
        (void)_;
        if (stat.count != static_cast<int>(plan.experiments.size()))
            stat.fixed = false;
    }

    return stats;
}

bool value_passes_range(const double value,
                        const double min,
                        const double max) noexcept
{
    return value >= min and value <= max;
}

bool experiment_matches_filters(const experiment_row& experiment,
                                const char*           id_filter,
                                const char*           parameter_filter,
                                const bool            use_range_filter,
                                const double          range_min,
                                const double          range_max) noexcept
{
    if (not contains_text(experiment.id, id_filter))
        return false;

    const auto use_parameter_filter = has_visible_char(parameter_filter);

    if (not use_parameter_filter and not use_range_filter)
        return true;

    for (const auto& [name, value] : experiment.parameters) {
        if (use_parameter_filter and not contains_text(name, parameter_filter))
            continue;

        if (use_range_filter and
            not value_passes_range(value, range_min, range_max))
            continue;

        return true;
    }

    return false;
}

void show_string_collection(const char* section_name,
                            const std::vector<std::string>& values)
{
    if (ImGui::TreeNode(section_name)) {
        if (values.empty()) {
            ImGui::TextUnformatted("<empty>");
        } else {
            for (const auto& value : values)
                ImGui::BulletText("%s", value.c_str());
        }

        ImGui::TreePop();
    }
}

void show_name_value_table(const char* table_id,
                           const std::map<std::string, double>& values)
{
    if (values.empty()) {
        ImGui::TextUnformatted("<empty>");
        return;
    }

    if (ImGui::BeginTable(table_id, 2, table_flags)) {
        ImGui::TableSetupColumn("name");
        ImGui::TableSetupColumn("value");
        ImGui::TableHeadersRow();

        for (const auto& [name, value] : values) {
            ImGui::TableNextRow();
            ImGui::TableNextColumn();
            ImGui::TextUnformatted(name.c_str());
            ImGui::TableNextColumn();
            ImGui::Text("%.17g", value);
        }

        ImGui::EndTable();
    }
}

void show_general_information(const experiment_plan& plan)
{
    if (not ImGui::CollapsingHeader("General Information",
                                    ImGuiTreeNodeFlags_DefaultOpen))
        return;

    ImGui::Text("request_id: %s", plan.request_id.c_str());
    ImGui::Text("plan_id: %s", plan.plan_id.c_str());
    ImGui::Text("model: %s", plan.model_name.c_str());
    ImGui::Text("t0: %.17g", plan.simulation.t0);
    ImGui::Text("horizon: %.17g", plan.simulation.horizon);
    ImGui::Text("dt: %.17g", plan.simulation.dt);
    ImGui::Text("experiments: %zu", plan.experiments.size());
}

void show_variables_to_record(const experiment_plan& plan)
{
    if (not ImGui::CollapsingHeader("Variables to Record",
                                    ImGuiTreeNodeFlags_DefaultOpen))
        return;

    show_string_collection("state_variables_to_record",
                           plan.state_variables_to_record);
    show_string_collection("outputs_to_record", plan.outputs_to_record);
}

void show_filtering(char*   filter_experiment_id,
                    size_t  filter_experiment_id_size,
                    char*   filter_parameter_name,
                    size_t  filter_parameter_name_size,
                    bool&   use_parameter_range_filter,
                    double& filter_parameter_min,
                    double& filter_parameter_max)
{
    if (not ImGui::CollapsingHeader("Filtering", ImGuiTreeNodeFlags_DefaultOpen))
        return;

    ImGui::SetNextItemWidth(240.0f);
    ImGui::InputText("experiment id contains",
                     filter_experiment_id,
                     filter_experiment_id_size);

    ImGui::SetNextItemWidth(240.0f);
    ImGui::InputText("parameter name contains",
                     filter_parameter_name,
                     filter_parameter_name_size);

    ImGui::Checkbox("use parameter range filter",
                    &use_parameter_range_filter);

    ImGui::BeginDisabled(not use_parameter_range_filter);
    ImGui::SetNextItemWidth(140.0f);
    ImGui::InputDouble("parameter min", &filter_parameter_min);
    ImGui::SameLine();
    ImGui::SetNextItemWidth(140.0f);
    ImGui::InputDouble("parameter max", &filter_parameter_max);
    ImGui::EndDisabled();

    if (use_parameter_range_filter and filter_parameter_min > filter_parameter_max)
        ImGui::TextColored(ImVec4{ 0.9f, 0.25f, 0.2f, 1.0f },
                           "range min is greater than max");
}

std::vector<int> make_filtered_experiment_indices(
  const experiment_plan& plan,
  const char*            filter_experiment_id,
  const char*            filter_parameter_name,
  const bool             use_parameter_range_filter,
  const double           filter_parameter_min,
  const double           filter_parameter_max)
{
    std::vector<int> indices;
    indices.reserve(plan.experiments.size());

    const auto use_range =
      use_parameter_range_filter and filter_parameter_min <= filter_parameter_max;

    for (std::size_t i = 0; i < plan.experiments.size(); ++i) {
        if (experiment_matches_filters(plan.experiments[i],
                                       filter_experiment_id,
                                       filter_parameter_name,
                                       use_range,
                                       filter_parameter_min,
                                       filter_parameter_max)) {
            indices.push_back(static_cast<int>(i));
        }
    }

    return indices;
}

void show_experiments_overview(const experiment_plan& plan,
                               const std::vector<int>& filtered_indices,
                               int& selected_experiment_index)
{
    if (not ImGui::CollapsingHeader("Experiments Overview",
                                    ImGuiTreeNodeFlags_DefaultOpen))
        return;

    ImGui::Text("visible experiments: %zu / %zu",
                filtered_indices.size(),
                plan.experiments.size());

    const auto child_height = 280.0f;

    if (ImGui::BeginTable("experiment-plan-overview",
                          4,
                          scroll_table_flags,
                          ImVec2{ 0.0f, child_height })) {
        ImGui::TableSetupColumn("index", ImGuiTableColumnFlags_WidthFixed);
        ImGui::TableSetupColumn("id");
        ImGui::TableSetupColumn("parameter_count",
                                ImGuiTableColumnFlags_WidthFixed);
        ImGui::TableSetupColumn("initial_state_count",
                                ImGuiTableColumnFlags_WidthFixed);
        ImGui::TableSetupScrollFreeze(0, 1);
        ImGui::TableHeadersRow();

        ImGuiListClipper clipper;
        clipper.Begin(static_cast<int>(filtered_indices.size()));

        while (clipper.Step()) {
            for (int row = clipper.DisplayStart; row < clipper.DisplayEnd;
                 ++row) {
                const auto experiment_index = filtered_indices[row];
                if (experiment_index < 0 or
                    experiment_index >=
                      static_cast<int>(plan.experiments.size()))
                    continue;

                const auto& experiment =
                  plan.experiments[static_cast<std::size_t>(experiment_index)];

                ImGui::PushID(experiment_index);
                ImGui::TableNextRow();
                ImGui::TableNextColumn();

                const auto selected =
                  selected_experiment_index == experiment_index;

                if (ImGui::Selectable(std::to_string(experiment_index).c_str(),
                                      selected,
                                      ImGuiSelectableFlags_SpanAllColumns))
                    selected_experiment_index = experiment_index;

                ImGui::TableNextColumn();
                ImGui::TextUnformatted(experiment.id.c_str());
                ImGui::TableNextColumn();
                ImGui::Text("%zu", experiment.parameters.size());
                ImGui::TableNextColumn();
                ImGui::Text("%zu", experiment.initial_states.size());
                ImGui::PopID();
            }
        }

        ImGui::EndTable();
    }
}

void show_experiment_details(const experiment_plan& plan,
                             const int selected_experiment_index)
{
    if (not ImGui::CollapsingHeader("Experiment Details",
                                    ImGuiTreeNodeFlags_DefaultOpen))
        return;

    if (selected_experiment_index < 0 or
        selected_experiment_index >= static_cast<int>(plan.experiments.size())) {
        ImGui::TextUnformatted("No experiment selected.");
        return;
    }

    const auto& experiment =
      plan.experiments[static_cast<std::size_t>(selected_experiment_index)];

    ImGui::Text("experiment id: %s", experiment.id.c_str());

    if (ImGui::TreeNode("Parameters")) {
        show_name_value_table("selected-experiment-parameters",
                              experiment.parameters);
        ImGui::TreePop();
    }

    if (ImGui::TreeNode("Initial States")) {
        show_name_value_table("selected-experiment-initial-states",
                              experiment.initial_states);
        ImGui::TreePop();
    }
}

void show_set_values(const char* section_name, const std::set<std::string>& values)
{
    if (ImGui::TreeNode(section_name)) {
        if (values.empty()) {
            ImGui::TextUnformatted("<empty>");
        } else {
            for (const auto& value : values)
                ImGui::BulletText("%s", value.c_str());
        }

        ImGui::TreePop();
    }
}

void show_statistics(const experiment_plan& plan, const plan_statistics& stats)
{
    if (not ImGui::CollapsingHeader("Statistics",
                                    ImGuiTreeNodeFlags_DefaultOpen))
        return;

    ImGui::Text("total experiments: %zu", plan.experiments.size());
    ImGui::Text("average parameters: %.3f", stats.average_parameter_count);
    ImGui::Text("average initial states: %.3f",
                stats.average_initial_state_count);

    show_set_values("unique parameters", stats.parameters);
    show_set_values("unique initial states", stats.initial_states);
}

void show_parameter_statistics(const experiment_plan& plan,
                               const plan_statistics& stats)
{
    if (not ImGui::CollapsingHeader("Parameter Statistics",
                                    ImGuiTreeNodeFlags_DefaultOpen))
        return;

    if (stats.parameter_stats.empty()) {
        ImGui::TextUnformatted("<empty>");
        return;
    }

    if (ImGui::BeginTable("parameter-statistics", 5, table_flags)) {
        ImGui::TableSetupColumn("name");
        ImGui::TableSetupColumn("type");
        ImGui::TableSetupColumn("min");
        ImGui::TableSetupColumn("max");
        ImGui::TableSetupColumn("mean");
        ImGui::TableHeadersRow();

        for (const auto& [name, stat] : stats.parameter_stats) {
            const auto fixed =
              stat.fixed and stat.count == static_cast<int>(plan.experiments.size());

            ImGui::TableNextRow();
            ImGui::TableNextColumn();
            ImGui::TextUnformatted(name.c_str());
            ImGui::TableNextColumn();
            ImGui::TextUnformatted(fixed ? "fixed" : "variable");
            ImGui::TableNextColumn();
            ImGui::Text("%.17g", stat.min);
            ImGui::TableNextColumn();
            ImGui::Text("%.17g", stat.max);
            ImGui::TableNextColumn();
            ImGui::Text("%.17g", stat.mean());
        }

        ImGui::EndTable();
    }
}

void show_validation_section(const std::optional<experiment_plan>& loaded_plan,
                             bool&                                plan_is_valid,
                             std::string& validation_message)
{
    if (not ImGui::CollapsingHeader("Validation",
                                    ImGuiTreeNodeFlags_DefaultOpen))
        return;

    if (not loaded_plan) {
        ImGui::TextUnformatted("No experiment plan loaded.");
        return;
    }

    if (ImGui::Button("Validate")) {
        plan_is_valid      = is_valid(*loaded_plan);
        validation_message = validation_report(*loaded_plan);
    }

    const auto valid = is_valid(*loaded_plan);
    const auto color =
      valid ? ImVec4{ 0.2f, 0.8f, 0.3f, 1.0f }
            : ImVec4{ 0.9f, 0.25f, 0.2f, 1.0f };

    ImGui::SameLine();
    ImGui::TextColored(color, valid ? "VALID" : "INVALID");

    if (validation_message.empty()) {
        plan_is_valid      = valid;
        validation_message = validation_report(*loaded_plan);
    }

    ImGui::TextWrapped("%s", validation_message.c_str());
}

void show_future_simulation()
{
    if (not ImGui::CollapsingHeader("Future Simulation",
                                    ImGuiTreeNodeFlags_DefaultOpen))
        return;

    ImGui::TextWrapped(
      "This experiment plan is loaded and ready for future Irritator-side "
      "nested simulation execution.");
}

} // namespace

void experiment_plan_viewer::show(application& app)
{
    ImGui::SetNextWindowDockID(app.get_main_dock_id(), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(780.0f, 760.0f), ImGuiCond_FirstUseEver);

    if (!ImGui::Begin(experiment_plan_viewer::name, &is_open)) {
        ImGui::End();
        show_load_dialog(app);
        return;
    }

    if (ImGui::CollapsingHeader("Load", ImGuiTreeNodeFlags_DefaultOpen)) {
        ImGui::SetNextItemWidth(-160.0f);
        ImGui::InputText("plan JSON", plan_path_, sizeof(plan_path_));

        if (ImGui::Button("Load experiment_plan.json"))
            load_from_path(app, std::filesystem::path{ plan_path_ });

        ImGui::SameLine();

        if (ImGui::Button("Browse...")) {
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

    show_validation_section(loaded_plan_,
                            plan_is_valid_,
                            validation_message_);

    if (loaded_plan_) {
        auto& plan = *loaded_plan_;

        if (selected_experiment_index_ >=
            static_cast<int>(plan.experiments.size()))
            selected_experiment_index_ = -1;

        const auto statistics = compute_statistics(plan);

        show_general_information(plan);
        show_variables_to_record(plan);
        show_filtering(filter_experiment_id_,
                       sizeof(filter_experiment_id_),
                       filter_parameter_name_,
                       sizeof(filter_parameter_name_),
                       use_parameter_range_filter_,
                       filter_parameter_min_,
                       filter_parameter_max_);

        const auto filtered_indices =
          make_filtered_experiment_indices(plan,
                                           filter_experiment_id_,
                                           filter_parameter_name_,
                                           use_parameter_range_filter_,
                                           filter_parameter_min_,
                                           filter_parameter_max_);

        show_experiments_overview(plan,
                                  filtered_indices,
                                  selected_experiment_index_);
        show_experiment_details(plan, selected_experiment_index_);
        show_statistics(plan, statistics);
        show_parameter_statistics(plan, statistics);
        show_future_simulation();
    } else {
        ImGui::TextUnformatted("No experiment plan loaded.");
    }

    ImGui::End();

    show_load_dialog(app);
}

void experiment_plan_viewer::load_from_path(application& app,
                                            const std::filesystem::path& path)
{
    selected_experiment_index_ = -1;
    loaded_plan_.reset();
    loaded_path_.clear();
    validation_message_.clear();
    plan_is_valid_ = false;

    if (path.empty()) {
        load_message_ = "Experiment plan path is empty.";
        app.jn.push(log_level::error, [](auto& title, auto& msg) noexcept {
            title = "Experiment Plan Viewer";
            msg   = "Experiment plan path is empty";
        });
        return;
    }

    if (not regular_file_exists(path)) {
        load_message_ = "Experiment plan file does not exist.";
        app.jn.push(log_level::error, [&](auto& title, auto& msg) noexcept {
            title = "Experiment Plan Viewer";
            format(msg, "Experiment plan file does not exist: {}", path.string());
        });
        return;
    }

    auto result = read_experiment_plan_json(path);
    if (result.has_error()) {
        const auto error = result.error();
        load_message_   = "Failed to read experiment plan JSON.";
        app.jn.push(log_level::error, [&, error](auto& title, auto& msg) noexcept {
            title = "Experiment Plan Viewer";
            format(msg,
                   "Failed to read experiment plan JSON {} (category {}, code "
                   "{})",
                   path.string(),
                   static_cast<int>(error.cat()),
                   error.value());
        });
        return;
    }

    loaded_plan_        = std::move(result).value();
    loaded_path_        = path;
    plan_is_valid_      = is_valid(*loaded_plan_);
    validation_message_ = validation_report(*loaded_plan_);

    if (not loaded_plan_->experiments.empty())
        selected_experiment_index_ = 0;

    const auto status = plan_is_valid_ ? "valid" : "invalid";
    load_message_     = plan_is_valid_ ? "Experiment plan loaded and valid."
                                       : "Experiment plan loaded but invalid.";

    app.jn.push(log_level::info, [&, status](auto& title, auto& msg) noexcept {
        title = "Experiment Plan Viewer";
        format(msg,
               "Experiment plan loaded from {} ({}, {} experiments)",
               path.string(),
               status,
               loaded_plan_->experiments.size());
    });
}

void experiment_plan_viewer::show_load_dialog(application& app)
{
    if (not load_dialog_requested_)
        return;

    const char*    title   = "Select experiment plan JSON";
    const char8_t* filters[] = { u8".json", nullptr };

    ImGui::OpenPopup(title);

    if (app.f_dialog.show_load_file(title, filters)) {
        if (app.f_dialog.state == file_dialog::status::ok) {
            const auto path = app.f_dialog.result;
            copy_to_buffer(plan_path_, path.string().c_str());
            load_from_path(app, path);
        }

        app.f_dialog.clear();
        load_dialog_requested_ = false;
    }
}

} // namespace irt
