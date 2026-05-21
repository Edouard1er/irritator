// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#include "experiment/plan-viewer.hpp"

#include "application.hpp"
#include "dialog.hpp"
#include "imgui.h"

#include <irritator/format.hpp>
#include <irritator/experiment-runner.hpp>

#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <numeric>
#include <limits>
#include <map>
#include <set>
#include <string>
#include <string_view>
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

bool is_bare_command(const std::string& value) noexcept
{
    return value.find('/') == std::string::npos and
           value.find('\\') == std::string::npos and
           value.find(':') == std::string::npos;
}

std::string strip_surrounding_quotes(std::string value)
{
    while (value.size() >= 2u and value.front() == '"' and
           value.back() == '"')
        value = value.substr(1u, value.size() - 2u);

    return value;
}

std::string make_native_argument(std::string value)
{
    value = strip_surrounding_quotes(std::move(value));

    if (value.empty() or is_bare_command(value))
        return value;

    auto path = std::filesystem::path{ value };
    path.make_preferred();
    return path.string();
}

std::string quote_command_argument(const std::string& value)
{
    const auto argument = make_native_argument(value);

    std::string ret;
    ret.reserve(argument.size() + 2u);
    ret.push_back('"');

    for (const auto c : argument) {
        if (c == '"')
            ret.push_back('\\');
        ret.push_back(c);
    }

    ret.push_back('"');
    return ret;
}

std::string make_raw_julia_command(const std::string&              julia_executable,
                                   const std::vector<std::string>& arguments)
{
    auto ret = quote_command_argument(julia_executable);

    for (const auto& argument : arguments) {
        ret.push_back(' ');
        ret += quote_command_argument(argument);
    }

    return ret;
}

std::string make_system_command(const std::string& raw_command)
{
#if defined(_WIN32)
    return std::string{ "cmd /C \"" } + raw_command + '"';
#else
    return raw_command;
#endif
}

bool is_repository_root(const std::filesystem::path& path) noexcept
{
    try {
        std::error_code ec;
        const auto      script =
          path / "tools" / "julia" / "analyze_experiment_results.jl";

        return std::filesystem::is_regular_file(script, ec) and not ec;
    } catch (...) {
        return false;
    }
}

std::filesystem::path find_repository_root_from(
  std::filesystem::path current) noexcept
{
    try {
        for (;;) {
            if (is_repository_root(current))
                return current;

            if (not current.has_parent_path() or
                current == current.parent_path())
                break;

            current = current.parent_path();
        }
    } catch (...) {
    }

    return {};
}

std::filesystem::path find_repository_root() noexcept
{
#if defined(IRT_SOURCE_ROOT)
    if (const auto source_root = std::filesystem::path{ IRT_SOURCE_ROOT };
        is_repository_root(source_root))
        return source_root;
#endif

    std::error_code ec;
    const auto      cwd = std::filesystem::current_path(ec);

    if (not ec)
        if (const auto root = find_repository_root_from(cwd); not root.empty())
            return root;

    return {};
}

std::string current_working_directory_string()
{
    std::error_code ec;
    const auto      cwd = std::filesystem::current_path(ec);

    if (ec)
        return std::string{ "<unavailable>" };

    return cwd.generic_string();
}

void show_file_status(const char* label, const bool exists)
{
    const auto color = exists ? ImVec4{ 0.2f, 0.8f, 0.3f, 1.0f }
                              : ImVec4{ 0.9f, 0.25f, 0.2f, 1.0f };

    ImGui::TextUnformatted(label);
    ImGui::SameLine();
    ImGui::TextColored(color, exists ? "found" : "missing");
}

const char* experiment_runner_error_message(const error_code error) noexcept
{
    switch (static_cast<experiment_runner_errc>(error.value())) {
    case experiment_runner_errc::invalid_simulation:
        return "Experiment plan run failed: invalid simulation settings.";
    case experiment_runner_errc::missing_parameter:
        return "Experiment plan run failed: missing parameter r, K, q or n.";
    case experiment_runner_errc::missing_initial_state:
        return "Experiment plan run failed: missing initial state B.";
    case experiment_runner_errc::invalid_value:
        return "Experiment plan run failed: invalid numeric value.";
    case experiment_runner_errc::numerical_error:
        return "Experiment plan run failed: numerical error.";
    case experiment_runner_errc::file_error:
        return "Experiment plan run failed: file error.";
    }

    return "Experiment plan run failed.";
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

struct run_summary_statistics {
    int    best_cumulative_catch_index = -1;
    int    best_final_biomass_index    = -1;
    double best_cumulative_catch       = 0.0;
    double best_final_biomass          = 0.0;
    double mean_cumulative_catch       = 0.0;
    double mean_final_biomass          = 0.0;
};

run_summary_statistics compute_run_summary(
  const experiment_run_results& results) noexcept
{
    run_summary_statistics stats;

    if (results.results.empty())
        return stats;

    auto sum_catch = 0.0;
    auto sum_final = 0.0;

    stats.best_cumulative_catch_index = 0;
    stats.best_final_biomass_index    = 0;
    stats.best_cumulative_catch =
      results.results.front().summary.cumulative_catch;
    stats.best_final_biomass = results.results.front().summary.final_B;

    for (std::size_t i = 0; i < results.results.size(); ++i) {
        const auto& summary = results.results[i].summary;

        sum_catch += summary.cumulative_catch;
        sum_final += summary.final_B;

        if (summary.cumulative_catch > stats.best_cumulative_catch) {
            stats.best_cumulative_catch = summary.cumulative_catch;
            stats.best_cumulative_catch_index = static_cast<int>(i);
        }

        if (summary.final_B > stats.best_final_biomass) {
            stats.best_final_biomass = summary.final_B;
            stats.best_final_biomass_index = static_cast<int>(i);
        }
    }

    const auto count = static_cast<double>(results.results.size());
    stats.mean_cumulative_catch = sum_catch / count;
    stats.mean_final_biomass    = sum_final / count;

    return stats;
}

std::vector<int> make_result_indices(
  const experiment_run_results& results,
  const bool                    sort_by_cumulative_catch_desc,
  const bool                    sort_by_final_biomass_desc)
{
    std::vector<int> indices(results.results.size());
    std::iota(indices.begin(), indices.end(), 0);

    if (sort_by_cumulative_catch_desc) {
        std::sort(indices.begin(), indices.end(), [&](const int lhs, const int rhs) {
            return results.results[static_cast<std::size_t>(lhs)]
                     .summary.cumulative_catch >
                   results.results[static_cast<std::size_t>(rhs)]
                     .summary.cumulative_catch;
        });
    } else if (sort_by_final_biomass_desc) {
        std::sort(indices.begin(), indices.end(), [&](const int lhs, const int rhs) {
            return results.results[static_cast<std::size_t>(lhs)]
                     .summary.final_B >
                   results.results[static_cast<std::size_t>(rhs)]
                     .summary.final_B;
        });
    }

    return indices;
}

void show_run_summary(const experiment_run_results& results,
                      const double                  duration_ms)
{
    if (not ImGui::CollapsingHeader("Run Summary##run_summary_section",
                                    ImGuiTreeNodeFlags_DefaultOpen))
        return;

    const auto stats = compute_run_summary(results);

    ImGui::Text("experiments executed: %zu", results.results.size());
    ImGui::Text("approximate execution time: %.3f ms", duration_ms);
    ImGui::Text("best cumulative_catch: %.17g", stats.best_cumulative_catch);
    ImGui::Text("best final_B: %.17g", stats.best_final_biomass);
    ImGui::Text("mean cumulative_catch: %.17g", stats.mean_cumulative_catch);
    ImGui::Text("mean final_B: %.17g", stats.mean_final_biomass);
}

void show_results_overview(const experiment_run_results& results,
                           int&                          selected_result_index,
                           bool& sort_by_cumulative_catch_desc,
                           bool& sort_by_final_biomass_desc)
{
    if (not ImGui::CollapsingHeader("Results Overview##results_overview_section",
                                    ImGuiTreeNodeFlags_DefaultOpen))
        return;

    if (ImGui::Checkbox("sort by cumulative_catch desc##sort_catch_desc",
                        &sort_by_cumulative_catch_desc)) {
        if (sort_by_cumulative_catch_desc)
            sort_by_final_biomass_desc = false;
    }

    ImGui::SameLine();

    if (ImGui::Checkbox("sort by final_B desc##sort_final_b_desc",
                        &sort_by_final_biomass_desc)) {
        if (sort_by_final_biomass_desc)
            sort_by_cumulative_catch_desc = false;
    }

    const auto indices = make_result_indices(results,
                                             sort_by_cumulative_catch_desc,
                                             sort_by_final_biomass_desc);

    if (ImGui::BeginTable("experiment-run-results-overview",
                          7,
                          scroll_table_flags,
                          ImVec2{ 0.0f, 280.0f })) {
        ImGui::TableSetupColumn("index", ImGuiTableColumnFlags_WidthFixed);
        ImGui::TableSetupColumn("experiment_id");
        ImGui::TableSetupColumn("final_B");
        ImGui::TableSetupColumn("min_B");
        ImGui::TableSetupColumn("max_B");
        ImGui::TableSetupColumn("mean_B");
        ImGui::TableSetupColumn("cumulative_catch");
        ImGui::TableSetupScrollFreeze(0, 1);
        ImGui::TableHeadersRow();

        ImGuiListClipper clipper;
        clipper.Begin(static_cast<int>(indices.size()));

        while (clipper.Step()) {
            for (int row = clipper.DisplayStart; row < clipper.DisplayEnd;
                 ++row) {
                const auto result_index = indices[static_cast<std::size_t>(row)];
                if (result_index < 0 or
                    result_index >= static_cast<int>(results.results.size()))
                    continue;

                const auto& result =
                  results.results[static_cast<std::size_t>(result_index)];
                const auto& summary = result.summary;
                const auto  selected = selected_result_index == result_index;

                ImGui::PushID(result_index);
                ImGui::TableNextRow();
                ImGui::TableNextColumn();

                if (ImGui::Selectable(std::to_string(result_index).c_str(),
                                      selected,
                                      ImGuiSelectableFlags_SpanAllColumns))
                    selected_result_index = result_index;

                ImGui::TableNextColumn();
                ImGui::TextUnformatted(result.experiment_id.c_str());
                ImGui::TableNextColumn();
                ImGui::Text("%.17g", summary.final_B);
                ImGui::TableNextColumn();
                ImGui::Text("%.17g", summary.min_B);
                ImGui::TableNextColumn();
                ImGui::Text("%.17g", summary.max_B);
                ImGui::TableNextColumn();
                ImGui::Text("%.17g", summary.mean_B);
                ImGui::TableNextColumn();
                ImGui::Text("%.17g", summary.cumulative_catch);
                ImGui::PopID();
            }
        }

        ImGui::EndTable();
    }
}

void show_result_details(const experiment_run_results& results,
                         const int selected_result_index)
{
    if (not ImGui::CollapsingHeader("Result Details##result_details_section",
                                    ImGuiTreeNodeFlags_DefaultOpen))
        return;

    if (selected_result_index < 0 or
        selected_result_index >= static_cast<int>(results.results.size())) {
        ImGui::TextUnformatted("No result selected.");
        return;
    }

    const auto& result =
      results.results[static_cast<std::size_t>(selected_result_index)];
    const auto& summary = result.summary;

    ImGui::Text("experiment_id: %s", result.experiment_id.c_str());

    if (ImGui::TreeNode("Summary##result_summary_tree")) {
        ImGui::Text("final_B: %.17g", summary.final_B);
        ImGui::Text("min_B: %.17g", summary.min_B);
        ImGui::Text("max_B: %.17g", summary.max_B);
        ImGui::Text("mean_B: %.17g", summary.mean_B);
        ImGui::Text("cumulative_catch: %.17g", summary.cumulative_catch);
        ImGui::TreePop();
    }

    if (ImGui::TreeNode("Trajectory Information##trajectory_information_tree")) {
        const auto point_count = result.biomass_trajectory.time.size();

        ImGui::Text("points: %zu", point_count);

        if (point_count > 0 and
            point_count == result.biomass_trajectory.values.size()) {
            ImGui::Text("time initial: %.17g",
                        result.biomass_trajectory.time.front());
            ImGui::Text("time final: %.17g",
                        result.biomass_trajectory.time.back());
            ImGui::Text("biomass initial: %.17g",
                        result.biomass_trajectory.values.front());
            ImGui::Text("biomass final: %.17g",
                        result.biomass_trajectory.values.back());
        }

        ImGui::TreePop();
    }
}

void show_best_experiments(const experiment_run_results& results)
{
    if (not ImGui::CollapsingHeader("Best Experiments##best_experiments_section",
                                    ImGuiTreeNodeFlags_DefaultOpen))
        return;

    if (results.results.empty()) {
        ImGui::TextUnformatted("<empty>");
        return;
    }

    const auto stats = compute_run_summary(results);

    if (stats.best_cumulative_catch_index >= 0) {
        const auto& result =
          results.results[static_cast<std::size_t>(
            stats.best_cumulative_catch_index)];
        ImGui::Text("best cumulative_catch: %s (%.17g)",
                    result.experiment_id.c_str(),
                    result.summary.cumulative_catch);
    }

    if (stats.best_final_biomass_index >= 0) {
        const auto& result =
          results.results[static_cast<std::size_t>(
            stats.best_final_biomass_index)];
        ImGui::Text("best final_B: %s (%.17g)",
                    result.experiment_id.c_str(),
                    result.summary.final_B);
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

void show_future_nested_simulation()
{
    if (not ImGui::CollapsingHeader(
          "Future Nested Simulation##future_nested_simulation_section",
                                    ImGuiTreeNodeFlags_DefaultOpen))
        return;

    ImGui::TextWrapped(
      "This experimental execution pipeline is a prototype preparation for "
      "future nested Irritator simulations (A**).");
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

    if (ImGui::CollapsingHeader("Load##plan_load_section",
                                ImGuiTreeNodeFlags_DefaultOpen)) {
        ImGui::SetNextItemWidth(-160.0f);
        ImGui::InputText(
          "plan JSON##plan_json_input", plan_path_, sizeof(plan_path_));

        if (ImGui::Button("Load experiment_plan.json##load_plan_button"))
            load_from_path(app, std::filesystem::path{ plan_path_ });

        ImGui::SameLine();

        if (ImGui::Button("Browse...##browse_plan_button")) {
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

    if (ImGui::CollapsingHeader("Run Experiment Plan##run_section",
                                ImGuiTreeNodeFlags_DefaultOpen)) {
        if (loaded_plan_) {
            const auto& plan = *loaded_plan_;

            ImGui::Text("experiments to run: %zu", plan.experiments.size());
            ImGui::Text("model: %s", plan.model_name.c_str());
            ImGui::Text("horizon: %.17g", plan.simulation.horizon);
            ImGui::Text("dt: %.17g", plan.simulation.dt);
        } else {
            ImGui::TextUnformatted("No experiment plan loaded.");
        }

        if (ImGui::Button("Run Experiment Plan##run_button"))
            run_loaded_plan(app);

        ImGui::SameLine();

        if (ImGui::Button("Clear Results##clear_results_button"))
            clear_run_results();

        if (not run_message_.empty())
            ImGui::TextWrapped("%s", run_message_.c_str());
    }

    show_julia_results_analysis(app);

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

        if (run_results_) {
            if (selected_result_index_ >=
                static_cast<int>(run_results_->results.size()))
                selected_result_index_ = -1;

            show_run_summary(*run_results_, last_run_duration_ms_);
            show_results_overview(*run_results_,
                                  selected_result_index_,
                                  sort_by_cumulative_catch_desc_,
                                  sort_by_final_biomass_desc_);
            show_result_details(*run_results_, selected_result_index_);
            show_best_experiments(*run_results_);

            if (ImGui::CollapsingHeader("Export Results##export_results_section",
                                        ImGuiTreeNodeFlags_DefaultOpen)) {
                ImGui::SetNextItemWidth(-170.0f);
                ImGui::InputText("results JSON##results_json_input",
                                 results_output_path_,
                                 sizeof(results_output_path_));

                if (ImGui::Button("Export Results JSON##export_results_button"))
                    export_results_to_path(
                      app, std::filesystem::path{ results_output_path_ });

                if (not export_results_message_.empty())
                    ImGui::TextWrapped("%s",
                                       export_results_message_.c_str());
            }
        }

        show_future_nested_simulation();
    } else {
        ImGui::TextUnformatted("No experiment plan loaded.");
    }

    ImGui::End();

    show_load_dialog(app);
}

void experiment_plan_viewer::show_julia_results_analysis(application& app)
{
    if (not ImGui::CollapsingHeader(
          "Julia Results Analysis##julia_results_analysis_section",
          ImGuiTreeNodeFlags_DefaultOpen))
        return;

    const auto cwd = current_working_directory_string();
    ImGui::TextWrapped("Current working directory: %s", cwd.c_str());

    ImGui::SetNextItemWidth(-220.0f);
    ImGui::InputText("Julia executable##analysis_julia_executable",
                     julia_analysis_executable_,
                     sizeof(julia_analysis_executable_));

    ImGui::SetNextItemWidth(-220.0f);
    ImGui::InputText("Julia analysis script##analysis_script",
                     julia_analysis_script_,
                     sizeof(julia_analysis_script_));

    ImGui::SetNextItemWidth(-220.0f);
    ImGui::InputText("Experiment results JSON##analysis_results_input",
                     experiment_results_input_path_,
                     sizeof(experiment_results_input_path_));

    ImGui::SetNextItemWidth(-220.0f);
    ImGui::InputText("Decision results JSON##analysis_decision_output",
                     decision_results_output_path_,
                     sizeof(decision_results_output_path_));

    const auto script_path =
      std::filesystem::path{ make_native_argument(julia_analysis_script_) };
    const auto results_path = std::filesystem::path{
        make_native_argument(experiment_results_input_path_)
    };
    const auto decision_path = std::filesystem::path{
        make_native_argument(decision_results_output_path_)
    };

    show_file_status("Julia analysis script:",
                     regular_file_exists(script_path));
    show_file_status("Experiment results JSON:",
                     regular_file_exists(results_path));
    show_file_status("Decision results JSON:",
                     regular_file_exists(decision_path));

    if (ImGui::Button(
          "Use repository absolute paths##analysis_use_repository_paths")) {
        if (const auto root = find_repository_root(); not root.empty()) {
            copy_to_buffer(julia_analysis_script_,
                           make_native_argument(
                             (root / "tools" / "julia" /
                              "analyze_experiment_results.jl")
                               .string())
                             .c_str());
            copy_to_buffer(experiment_results_input_path_,
                           make_native_argument(
                             (root / "experiment_results.json").string())
                             .c_str());
            copy_to_buffer(decision_results_output_path_,
                           make_native_argument(
                             (root / "decision_results.json").string())
                             .c_str());
            analysis_message_ = "Repository absolute paths applied.";
        } else {
            analysis_message_ = "Repository root not found.";
        }
    }

    if (ImGui::Button("Analyze Results with Julia##analysis_run_button"))
        analyze_results_with_julia(app);

    ImGui::Text("Last analysis exit code: %d", last_analysis_exit_code_);

    if (not last_analysis_command_.empty())
        ImGui::TextWrapped("Last analysis command: %s",
                           last_analysis_command_.c_str());

    if (not analysis_message_.empty())
        ImGui::TextWrapped("%s", analysis_message_.c_str());
}

void experiment_plan_viewer::analyze_results_with_julia(application& app)
{
    analysis_message_.clear();
    last_analysis_command_.clear();
    last_analysis_exit_code_ = 0;

    const auto cwd = current_working_directory_string();
    const auto script_path =
      std::filesystem::path{ make_native_argument(julia_analysis_script_) };
    const auto results_path = std::filesystem::path{
        make_native_argument(experiment_results_input_path_)
    };
    const auto decision_path = std::filesystem::path{
        make_native_argument(decision_results_output_path_)
    };

    if (not regular_file_exists(results_path)) {
        analysis_message_ =
          "Experiment results JSON not found. Export results first.";
        const auto path = results_path.string();
        app.jn.push(log_level::error, [=](auto& title, auto& msg) noexcept {
            title = "Experiment Plan Viewer";
            format(msg,
                   "Julia analysis cancelled: experiment results JSON not "
                   "found. cwd: {}, path: {}",
                   cwd,
                   path);
        });
        return;
    }

    if (not regular_file_exists(script_path)) {
        analysis_message_ = "Julia analysis script not found.";
        const auto path   = script_path.string();
        app.jn.push(log_level::error, [=](auto& title, auto& msg) noexcept {
            title = "Experiment Plan Viewer";
            format(msg,
                   "Julia analysis cancelled: script not found. cwd: {}, "
                   "path: {}",
                   cwd,
                   path);
        });
        return;
    }

    std::error_code remove_ec;
    std::filesystem::remove(decision_path, remove_ec);

    const auto raw_command = make_raw_julia_command(
      julia_analysis_executable_,
      { julia_analysis_script_,
        experiment_results_input_path_,
        decision_results_output_path_ });
    const auto system_command = make_system_command(raw_command);
    last_analysis_command_    = system_command;

    app.jn.push(log_level::info, [=](auto& title, auto& msg) noexcept {
        title = "Experiment Plan Viewer";
        format(msg,
               "Julia analysis started. cwd: {}, raw command: {}, command "
               "passed to system: {}",
               cwd,
               raw_command,
               system_command);
    });

    // Appel synchrone volontaire pour cette premiere analyse decisionnelle.
    // Aucune simulation Irritator n'est lancee ici.
    const auto exit_code = std::system(system_command.c_str());
    last_analysis_exit_code_ = exit_code;

    const auto decision_exists = regular_file_exists(decision_path);
    const auto decision        = decision_path.string();

    app.jn.push(exit_code == 0 and decision_exists ? log_level::info
                                                   : log_level::error,
                [=](auto& title, auto& msg) noexcept {
                    title = "Experiment Plan Viewer";
                    format(msg,
                           "Julia analysis finished. cwd: {}, raw command: "
                           "{}, command passed to system: {}, exit code: {}, "
                           "decision results: {}",
                           cwd,
                           raw_command,
                           system_command,
                           exit_code,
                           decision);
                });

    if (exit_code != 0) {
        analysis_message_ = "Julia analysis failed.";
        return;
    }

    if (not decision_exists) {
        analysis_message_ =
          "Julia analysis failed. Decision results JSON was not created.";
        return;
    }

    analysis_message_ = "Decision results generated successfully.";
}

void experiment_plan_viewer::clear_run_results() noexcept
{
    run_results_.reset();
    run_completed_ = false;
    selected_result_index_ = -1;
    last_run_duration_ms_ = 0.0;
    export_results_message_.clear();
    run_message_ = "Experiment run results cleared.";
}

void experiment_plan_viewer::run_loaded_plan(application& app)
{
    run_results_.reset();
    run_completed_ = false;
    selected_result_index_ = -1;
    last_run_duration_ms_ = 0.0;
    export_results_message_.clear();

    if (not loaded_plan_) {
        run_message_ = "No experiment plan loaded.";
        app.jn.push(log_level::warning, [](auto& title, auto& msg) noexcept {
            title = "Experiment Plan Viewer";
            msg   = "Run cancelled: no experiment plan loaded";
        });
        return;
    }

    plan_is_valid_      = is_valid(*loaded_plan_);
    validation_message_ = validation_report(*loaded_plan_);

    if (not plan_is_valid_) {
        run_message_ = "Loaded experiment plan is invalid.";
        app.jn.push(log_level::error, [](auto& title, auto& msg) noexcept {
            title = "Experiment Plan Viewer";
            msg   = "Run cancelled: loaded experiment plan is invalid";
        });
        return;
    }

    const auto experiment_count = loaded_plan_->experiments.size();

    app.jn.push(log_level::info, [=](auto& title, auto& msg) noexcept {
        title = "Experiment Plan Viewer";
        format(msg,
               "Starting experimental Schaefer run for {} experiments",
               experiment_count);
    });

    const auto start = std::chrono::steady_clock::now();

    // Prototype volontairement synchrone et hors moteur DEVS.
    auto result = run_experiment_plan(*loaded_plan_);

    const auto finish = std::chrono::steady_clock::now();
    last_run_duration_ms_ =
      std::chrono::duration<double, std::milli>(finish - start).count();

    if (result.has_error()) {
        const auto error = result.error();
        run_message_ = experiment_runner_error_message(error);
        app.jn.push(log_level::error, [=](auto& title, auto& msg) noexcept {
            title = "Experiment Plan Viewer";
            format(msg,
                   "Experiment plan run failed (category {}, code {})",
                   static_cast<int>(error.cat()),
                   error.value());
        });
        return;
    }

    run_results_   = std::move(result).value();
    run_completed_ = true;

    if (not run_results_->results.empty())
        selected_result_index_ = 0;

    const auto result_count = run_results_->results.size();
    run_message_ = "Experiment plan run completed.";

    app.jn.push(log_level::info, [=](auto& title, auto& msg) noexcept {
        title = "Experiment Plan Viewer";
        format(msg,
               "Experimental Schaefer run completed: {} results in {:.3f} ms",
               result_count,
               last_run_duration_ms_);
    });
}

void experiment_plan_viewer::export_results_to_path(
  application&                 app,
  const std::filesystem::path& path)
{
    if (not run_results_) {
        export_results_message_ = "No experiment run results to export.";
        app.jn.push(log_level::warning, [](auto& title, auto& msg) noexcept {
            title = "Experiment Plan Viewer";
            msg   = "Results export cancelled: no run results";
        });
        return;
    }

    if (path.empty()) {
        export_results_message_ = "Results JSON path is empty.";
        app.jn.push(log_level::error, [](auto& title, auto& msg) noexcept {
            title = "Experiment Plan Viewer";
            msg   = "Results JSON path is empty";
        });
        return;
    }

    const auto status = write_experiment_results_json(path, *run_results_);
    if (status.has_error()) {
        const auto error = status.error();
        export_results_message_ = "Failed to export experiment results JSON.";
        app.jn.push(log_level::error, [=](auto& title, auto& msg) noexcept {
            title = "Experiment Plan Viewer";
            format(msg,
                   "Failed to export experiment results JSON {} (category {}, "
                   "code {})",
                   path.string(),
                   static_cast<int>(error.cat()),
                   error.value());
        });
        return;
    }

    if (not regular_file_exists(path)) {
        export_results_message_ = "Experiment results JSON was not created.";
        app.jn.push(log_level::error, [=](auto& title, auto& msg) noexcept {
            title = "Experiment Plan Viewer";
            format(msg,
                   "Experiment results JSON was not created: {}",
                   path.string());
        });
        return;
    }

    export_results_message_ = "Experiment results JSON exported.";
    copy_to_buffer(experiment_results_input_path_, path.string().c_str());

    app.jn.push(log_level::info, [=](auto& title, auto& msg) noexcept {
        title = "Experiment Plan Viewer";
        format(msg, "Experiment results JSON exported to {}", path.string());
    });
}

void experiment_plan_viewer::load_from_path(application& app,
                                            const std::filesystem::path& path)
{
    selected_experiment_index_ = -1;
    run_results_.reset();
    run_completed_ = false;
    selected_result_index_ = -1;
    last_run_duration_ms_ = 0.0;
    run_message_.clear();
    export_results_message_.clear();
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
