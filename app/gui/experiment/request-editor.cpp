// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#include "experiment/request-editor.hpp"

#include "application.hpp"
#include "dialog.hpp"
#include "imgui.h"

#include <irritator/format.hpp>

#include <array>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace irt {
namespace {

constexpr auto table_flags =
  ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg | ImGuiTableFlags_Resizable;

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

template<std::size_t Size>
void clear_buffer(char (&buffer)[Size]) noexcept
{
    if constexpr (Size > 0)
        buffer[0] = '\0';
}

bool has_visible_char(const char* value) noexcept
{
    if (not value)
        return false;

    for (auto it = value; *it != '\0'; ++it) {
        if (not std::isspace(static_cast<unsigned char>(*it)))
            return true;
    }

    return false;
}

template<std::size_t Size>
bool input_string(const char* label, std::string& value)
{
    std::array<char, Size> buffer{};
    copy_to_buffer(buffer.data(), buffer.size(), value.c_str());

    if (ImGui::InputText(label, buffer.data(), buffer.size())) {
        value = buffer.data();
        return true;
    }

    return false;
}

template<typename Vector>
void erase_index(Vector& values, const int index)
{
    if (index >= 0 and static_cast<std::size_t>(index) < values.size())
        values.erase(values.begin() + index);
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

bool regular_file_exists(const std::string& path) noexcept
{
    try {
        std::error_code ec;
        return std::filesystem::is_regular_file(std::filesystem::path{ path },
                                                ec) &&
               not ec;
    } catch (...) {
        return false;
    }
}

bool path_exists(const std::filesystem::path& path) noexcept
{
    try {
        std::error_code ec;
        return std::filesystem::exists(path, ec) and not ec;
    } catch (...) {
        return false;
    }
}

std::filesystem::path find_julia_executable() noexcept
{
    try {
#if defined(_WIN32)
        if (const auto* user_profile = std::getenv("USERPROFILE");
            user_profile and *user_profile != '\0') {
            const auto user = std::filesystem::path{ user_profile };

            const auto juliaup_bin =
              user / ".juliaup" / "bin" / "julia.exe";
            if (path_exists(juliaup_bin))
                return juliaup_bin;

            const auto julia_juliaup = user / ".julia" / "juliaup";
            std::error_code ec;
            if (std::filesystem::is_directory(julia_juliaup, ec)) {
                for (const auto& entry :
                     std::filesystem::directory_iterator(julia_juliaup, ec)) {
                    if (ec)
                        break;

                    if (not entry.is_directory(ec))
                        continue;

                    const auto candidate =
                      entry.path() / "bin" / "julia.exe";
                    if (path_exists(candidate))
                        return candidate;
                }
            }

            const auto windows_app =
              user / "AppData" / "Local" / "Microsoft" / "WindowsApps" /
              "julia.exe";
            if (path_exists(windows_app))
                return windows_app;
        }

        if (const auto* local_app_data = std::getenv("LOCALAPPDATA");
            local_app_data and *local_app_data != '\0') {
            const auto programs =
              std::filesystem::path{ local_app_data } / "Programs";
            std::error_code ec;
            if (std::filesystem::is_directory(programs, ec)) {
                for (const auto& entry :
                     std::filesystem::directory_iterator(programs, ec)) {
                    if (ec)
                        break;

                    if (not entry.is_directory(ec))
                        continue;

                    const auto name = entry.path().filename().string();
                    if (name.find("Julia") == std::string::npos and
                        name.find("julia") == std::string::npos)
                        continue;

                    const auto candidate =
                      entry.path() / "bin" / "julia.exe";
                    if (path_exists(candidate))
                        return candidate;
                }
            }
        }
#endif
    } catch (...) {
    }

    return {};
}

bool is_repository_root(const std::filesystem::path& path) noexcept
{
    try {
        std::error_code ec;
        const auto      script =
          path / "tools" / "julia" / "generate_experiment_plan.jl";

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

    {
        std::error_code ec;
        const auto      cwd = std::filesystem::current_path(ec);

        if (not ec)
            if (const auto root = find_repository_root_from(cwd);
                not root.empty())
                return root;
    }

    if (auto executable = get_executable_directory(); executable.has_value()) {
        auto path = executable.value();

        if (path.has_filename())
            path = path.parent_path();

        if (const auto root = find_repository_root_from(path);
            not root.empty())
            return root;
    }

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

void show_executable_status(const char*       label,
                            const std::string& executable,
                            const bool        exists)
{
    const auto color = exists ? ImVec4{ 0.2f, 0.8f, 0.3f, 1.0f }
                              : ImVec4{ 0.95f, 0.55f, 0.15f, 1.0f };

    ImGui::TextUnformatted(label);
    ImGui::SameLine();

    if (exists)
        ImGui::TextColored(color, "absolute path found");
    else if (is_bare_command(executable))
        ImGui::TextColored(color, "PATH command, not verified");
    else
        ImGui::TextColored(color, "missing");
}

void log_julia_command(application&       app,
                       log_level          level,
                       const char*        context,
                       const std::string& raw_command,
                       const std::string& system_command,
                       const std::string& cwd,
                       const int          exit_code)
{
    app.jn.push(level, [=](auto& title, auto& msg) noexcept {
        title = "Experiment Request Editor";
        format(msg,
               "{} | raw command: {} | command passed to system: {} | current "
               "working directory: {} | exit code: {}",
               context,
               raw_command,
               system_command,
               cwd,
               exit_code);
    });
}

void show_general(experiment_request& request)
{
    if (ImGui::CollapsingHeader("General", ImGuiTreeNodeFlags_DefaultOpen)) {
        input_string<128>("request_id", request.request_id);
        input_string<128>("model_name", request.model_name);
    }
}

void show_simulation_settings(experiment_request& request)
{
    if (ImGui::CollapsingHeader("Simulation settings",
                                ImGuiTreeNodeFlags_DefaultOpen)) {
        ImGui::InputDouble("t0", &request.simulation.t0);
        ImGui::InputDouble("horizon", &request.simulation.horizon);
        ImGui::InputDouble("dt", &request.simulation.dt);
        ImGui::InputInt("number_of_simulations",
                        &request.simulation.number_of_simulations);
    }
}

void show_generation_method(experiment_request& request)
{
    if (ImGui::CollapsingHeader("Generation method",
                                ImGuiTreeNodeFlags_DefaultOpen)) {
        constexpr const char* methods[] = {
            "uniform_grid",
            "random_uniform",
            "latin_hypercube",
        };

        const char* current =
          request.generation.type.empty() ? "" : request.generation.type.c_str();

        if (ImGui::BeginCombo("type", current)) {
            for (const auto* method : methods) {
                const bool selected = request.generation.type == method;

                if (ImGui::Selectable(method, selected))
                    request.generation.type = method;

                if (selected)
                    ImGui::SetItemDefaultFocus();
            }

            ImGui::EndCombo();
        }

        ImGui::InputScalar(
          "seed", ImGuiDataType_U64, &request.generation.seed);
    }
}

template<std::size_t Size>
void show_fixed_parameters(experiment_request& request,
                           char (&name)[Size],
                           double& value)
{
    if (ImGui::CollapsingHeader("Fixed parameters",
                                ImGuiTreeNodeFlags_DefaultOpen)) {
        int remove_index = -1;

        if (ImGui::BeginTable("fixed-parameters", 3, table_flags)) {
            ImGui::TableSetupColumn("name");
            ImGui::TableSetupColumn("value");
            ImGui::TableSetupColumn("action", ImGuiTableColumnFlags_WidthFixed);
            ImGui::TableHeadersRow();

            for (std::size_t i = 0; i < request.fixed_parameters.size(); ++i) {
                auto& parameter = request.fixed_parameters[i];

                ImGui::PushID(static_cast<int>(i));
                ImGui::TableNextRow();
                ImGui::TableNextColumn();
                ImGui::SetNextItemWidth(-1.0f);
                input_string<96>("##fixed-name", parameter.name);

                ImGui::TableNextColumn();
                ImGui::SetNextItemWidth(-1.0f);
                ImGui::InputDouble("##fixed-value", &parameter.value);

                ImGui::TableNextColumn();
                if (ImGui::Button("Remove##fixed"))
                    remove_index = static_cast<int>(i);
                ImGui::PopID();
            }

            ImGui::EndTable();
        }

        erase_index(request.fixed_parameters, remove_index);

        ImGui::SetNextItemWidth(160.0f);
        ImGui::InputText("name##fixed-new", name, Size);
        ImGui::SameLine();
        ImGui::SetNextItemWidth(140.0f);
        ImGui::InputDouble("value##fixed-new", &value);
        ImGui::SameLine();

        if (ImGui::Button("Add fixed parameter") and has_visible_char(name)) {
            request.fixed_parameters.push_back({ name, value });
            clear_buffer(name);
            value = 0.0;
        }
    }
}

template<std::size_t NameSize, std::size_t DistributionSize>
void show_variable_parameters(experiment_request& request,
                              char (&name)[NameSize],
                              char (&distribution)[DistributionSize],
                              double& min,
                              double& max)
{
    if (ImGui::CollapsingHeader("Variable parameters",
                                ImGuiTreeNodeFlags_DefaultOpen)) {
        int remove_index = -1;

        if (ImGui::BeginTable("variable-parameters", 5, table_flags)) {
            ImGui::TableSetupColumn("name");
            ImGui::TableSetupColumn("distribution");
            ImGui::TableSetupColumn("min");
            ImGui::TableSetupColumn("max");
            ImGui::TableSetupColumn("action", ImGuiTableColumnFlags_WidthFixed);
            ImGui::TableHeadersRow();

            for (std::size_t i = 0; i < request.variable_parameters.size();
                 ++i) {
                auto& parameter = request.variable_parameters[i];

                ImGui::PushID(static_cast<int>(i));
                ImGui::TableNextRow();
                ImGui::TableNextColumn();
                ImGui::SetNextItemWidth(-1.0f);
                input_string<96>("##variable-name", parameter.name);

                ImGui::TableNextColumn();
                ImGui::SetNextItemWidth(-1.0f);
                input_string<96>("##variable-distribution",
                                 parameter.distribution);

                ImGui::TableNextColumn();
                ImGui::SetNextItemWidth(-1.0f);
                ImGui::InputDouble("##variable-min", &parameter.min);

                ImGui::TableNextColumn();
                ImGui::SetNextItemWidth(-1.0f);
                ImGui::InputDouble("##variable-max", &parameter.max);

                ImGui::TableNextColumn();
                if (ImGui::Button("Remove##variable"))
                    remove_index = static_cast<int>(i);
                ImGui::PopID();
            }

            ImGui::EndTable();
        }

        erase_index(request.variable_parameters, remove_index);

        ImGui::SetNextItemWidth(130.0f);
        ImGui::InputText("name##variable-new", name, NameSize);
        ImGui::SameLine();
        ImGui::SetNextItemWidth(130.0f);
        ImGui::InputText(
          "distribution##variable-new", distribution, DistributionSize);
        ImGui::SameLine();
        ImGui::SetNextItemWidth(100.0f);
        ImGui::InputDouble("min##variable-new", &min);
        ImGui::SameLine();
        ImGui::SetNextItemWidth(100.0f);
        ImGui::InputDouble("max##variable-new", &max);
        ImGui::SameLine();

        if (ImGui::Button("Add variable parameter") and
            has_visible_char(name)) {
            const auto used_distribution =
              has_visible_char(distribution) ? distribution : "uniform";

            request.variable_parameters.push_back(
              { name, used_distribution, min, max });
            clear_buffer(name);
            copy_to_buffer(distribution, "uniform");
            min = 0.0;
            max = 0.0;
        }
    }
}

template<std::size_t Size>
void show_initial_states(experiment_request& request,
                         char (&name)[Size],
                         double& value)
{
    if (ImGui::CollapsingHeader("Initial states",
                                ImGuiTreeNodeFlags_DefaultOpen)) {
        int remove_index = -1;

        if (ImGui::BeginTable("initial-states", 3, table_flags)) {
            ImGui::TableSetupColumn("name");
            ImGui::TableSetupColumn("value");
            ImGui::TableSetupColumn("action", ImGuiTableColumnFlags_WidthFixed);
            ImGui::TableHeadersRow();

            for (std::size_t i = 0; i < request.initial_states.size(); ++i) {
                auto& state = request.initial_states[i];

                ImGui::PushID(static_cast<int>(i));
                ImGui::TableNextRow();
                ImGui::TableNextColumn();
                ImGui::SetNextItemWidth(-1.0f);
                input_string<96>("##initial-state-name", state.name);

                ImGui::TableNextColumn();
                ImGui::SetNextItemWidth(-1.0f);
                ImGui::InputDouble("##initial-state-value", &state.value);

                ImGui::TableNextColumn();
                if (ImGui::Button("Remove##initial-state"))
                    remove_index = static_cast<int>(i);
                ImGui::PopID();
            }

            ImGui::EndTable();
        }

        erase_index(request.initial_states, remove_index);

        ImGui::SetNextItemWidth(160.0f);
        ImGui::InputText("name##initial-state-new", name, Size);
        ImGui::SameLine();
        ImGui::SetNextItemWidth(140.0f);
        ImGui::InputDouble("value##initial-state-new", &value);
        ImGui::SameLine();

        if (ImGui::Button("Add initial state") and has_visible_char(name)) {
            request.initial_states.push_back({ name, value });
            clear_buffer(name);
            value = 0.0;
        }
    }
}

template<std::size_t Size>
void show_string_list(const char*              section_name,
                      const char*              table_name,
                      const char*              input_label,
                      const char*              button_label,
                      std::vector<std::string>& values,
                      char (&name)[Size])
{
    if (ImGui::CollapsingHeader(section_name, ImGuiTreeNodeFlags_DefaultOpen)) {
        ImGui::PushID(table_name);

        int remove_index = -1;

        if (ImGui::BeginTable(table_name, 2, table_flags)) {
            ImGui::TableSetupColumn("name");
            ImGui::TableSetupColumn("action", ImGuiTableColumnFlags_WidthFixed);
            ImGui::TableHeadersRow();

            for (std::size_t i = 0; i < values.size(); ++i) {
                ImGui::PushID(static_cast<int>(i));
                ImGui::TableNextRow();
                ImGui::TableNextColumn();
                ImGui::SetNextItemWidth(-1.0f);
                input_string<96>("##name", values[i]);

                ImGui::TableNextColumn();
                if (ImGui::Button("Remove"))
                    remove_index = static_cast<int>(i);
                ImGui::PopID();
            }

            ImGui::EndTable();
        }

        erase_index(values, remove_index);

        ImGui::SetNextItemWidth(180.0f);
        ImGui::InputText(input_label, name, Size);
        ImGui::SameLine();

        if (ImGui::Button(button_label) and has_visible_char(name)) {
            values.emplace_back(name);
            clear_buffer(name);
        }

        ImGui::PopID();
    }
}

void show_validation(experiment_request&        request,
                     std::string&               validation_message,
                     bool&                      validation_is_valid)
{
    if (ImGui::CollapsingHeader("Validation",
                                ImGuiTreeNodeFlags_DefaultOpen)) {
        if (ImGui::Button("Validate")) {
            validation_message  = validation_report(request);
            validation_is_valid = is_valid(request);
        }

        const auto valid = is_valid(request);
        const auto color =
          valid ? ImVec4{ 0.2f, 0.8f, 0.3f, 1.0f }
                : ImVec4{ 0.9f, 0.25f, 0.2f, 1.0f };

        ImGui::SameLine();
        ImGui::TextColored(color, valid ? "Valid" : "Invalid");

        if (validation_message.empty()) {
            validation_message  = validation_report(request);
            validation_is_valid = valid;
        }

        ImGui::TextWrapped("%s", validation_message.c_str());
    }
}

} // namespace

experiment_request_editor::experiment_request_editor()
{
    reset();
}

void experiment_request_editor::reset()
{
    request_ = {};

    request_.request_id = "req_001";
    request_.model_name = "SchaeferBiomass";

    request_.simulation.t0                    = 0.0;
    request_.simulation.horizon               = 50.0;
    request_.simulation.dt                    = 0.1;
    request_.simulation.number_of_simulations = 100;

    request_.generation.type = "latin_hypercube";
    request_.generation.seed = 12345u;

    request_.fixed_parameters = {
        { "r", 0.45 },
        { "K", 1000.0 },
        { "q", 0.001 },
    };

    request_.variable_parameters = {
        { "n", "uniform", 20.0, 200.0 },
    };

    request_.initial_states = {
        { "B", 500.0 },
    };

    request_.state_variables_to_record = { "B" };
    request_.outputs_to_record         = { "catch" };

    clear_buffer(fixed_parameter_name_);
    fixed_parameter_value_ = 0.0;

    clear_buffer(variable_parameter_name_);
    copy_to_buffer(variable_parameter_distribution_, "uniform");
    variable_parameter_min_ = 0.0;
    variable_parameter_max_ = 0.0;

    clear_buffer(initial_state_name_);
    initial_state_value_ = 0.0;

    clear_buffer(state_variable_name_);
    clear_buffer(output_name_);

    validation_message_  = validation_report(request_);
    validation_is_valid_ = is_valid(request_);
    last_export_path_.clear();
    export_dialog_requested_ = false;

    julia_executable_        = "julia";
    julia_script_path_       = "tools/julia/generate_experiment_plan.jl";
    julia_request_json_path_ = "experiment_request.json";
    julia_plan_json_path_    = "experiment_plan.json";
    julia_generation_message_.clear();
    last_julia_command_.clear();
    last_julia_raw_command_.clear();
    last_julia_system_command_.clear();
    last_julia_exit_code_ = 0;
    has_last_julia_exit_code_ = false;
    last_julia_test_exit_code_ = 0;
    has_last_julia_test_exit_code_ = false;
    last_julia_test_succeeded_ = false;
    update_julia_path_status();
}

void experiment_request_editor::show(application& app)
{
    ImGui::SetNextWindowDockID(app.get_main_dock_id(), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(720.0f, 760.0f), ImGuiCond_FirstUseEver);

    if (!ImGui::Begin(experiment_request_editor::name, &is_open)) {
        ImGui::End();
        show_export_dialog(app);
        return;
    }

    if (ImGui::Button("Reset"))
        reset();

    show_general(request_);
    show_simulation_settings(request_);
    show_generation_method(request_);
    show_fixed_parameters(
      request_, fixed_parameter_name_, fixed_parameter_value_);
    show_variable_parameters(request_,
                             variable_parameter_name_,
                             variable_parameter_distribution_,
                             variable_parameter_min_,
                             variable_parameter_max_);
    show_initial_states(request_, initial_state_name_, initial_state_value_);
    show_string_list("State variables to record",
                     "state-variables-to-record",
                     "name##state-variable-new",
                     "Add",
                     request_.state_variables_to_record,
                     state_variable_name_);
    show_string_list("Outputs to record",
                     "outputs-to-record",
                     "name##output-new",
                     "Add",
                     request_.outputs_to_record,
                     output_name_);
    show_validation(request_, validation_message_, validation_is_valid_);

    if (ImGui::CollapsingHeader("Export", ImGuiTreeNodeFlags_DefaultOpen)) {
        if (ImGui::Button("Export JSON")) {
            validation_message_  = validation_report(request_);
            validation_is_valid_ = is_valid(request_);

            if (validation_is_valid_) {
                export_dialog_requested_ = true;
            } else {
                app.jn.push(log_level::warning,
                            [](auto& title, auto& msg) noexcept {
                                title = "Experiment Request Editor";
                                msg   = "Invalid experiment request, export "
                                      "cancelled";
                            });
            }
        }

        if (not last_export_path_.empty()) {
            const auto path = last_export_path_.string();
            ImGui::TextWrapped("Last export: %s", path.c_str());
        }
    }

    show_julia_plan_generation(app);

    ImGui::End();

    show_export_dialog(app);
}

bool experiment_request_editor::export_request_to_path(
  application&                 app,
  const std::filesystem::path& path)
{
    validation_message_  = validation_report(request_);
    validation_is_valid_ = is_valid(request_);

    if (not validation_is_valid_) {
        julia_generation_message_ =
          "Invalid experiment request, export cancelled.";
        app.jn.push(log_level::warning, [](auto& title, auto& msg) noexcept {
            title = "Experiment Request Editor";
            msg   = "Invalid experiment request, export cancelled";
        });
        return false;
    }

    if (path.empty()) {
        julia_generation_message_ = "Request JSON path is empty.";
        app.jn.push(log_level::error, [](auto& title, auto& msg) noexcept {
            title = "Experiment Request Editor";
            msg   = "Request JSON path is empty";
        });
        return false;
    }

    if (write_experiment_request_json(path, request_)) {
        last_export_path_ = path;
        app.jn.push(log_level::info, [&](auto& title, auto& msg) noexcept {
            title = "Experiment Request Editor";
            format(msg, "Experiment request exported to {}", path.string());
        });
        return true;
    }

    julia_generation_message_ = "Failed to export experiment request JSON.";
    app.jn.push(log_level::error, [&](auto& title, auto& msg) noexcept {
        title = "Experiment Request Editor";
        format(msg, "Failed to export experiment request to {}", path.string());
    });
    return false;
}

void experiment_request_editor::update_julia_path_status() noexcept
{
    try {
        const auto executable = make_native_argument(julia_executable_);

        julia_executable_exists_ =
          not is_bare_command(executable) and path_exists(executable);
        julia_script_exists_ =
          regular_file_exists(make_native_argument(julia_script_path_));
        julia_request_json_exists_ =
          regular_file_exists(make_native_argument(julia_request_json_path_));
        julia_plan_json_exists_ =
          regular_file_exists(make_native_argument(julia_plan_json_path_));
    } catch (...) {
        julia_executable_exists_    = false;
        julia_script_exists_        = false;
        julia_request_json_exists_  = false;
        julia_plan_json_exists_     = false;
    }
}

void experiment_request_editor::show_julia_plan_generation(application& app)
{
    if (not ImGui::CollapsingHeader("Julia Plan Generation",
                                    ImGuiTreeNodeFlags_DefaultOpen))
        return;

    update_julia_path_status();

    const auto cwd = current_working_directory_string();
    ImGui::TextWrapped("Current working directory: %s", cwd.c_str());

    if (ImGui::Button("Use repository absolute paths")) {
        if (const auto root = find_repository_root(); not root.empty()) {
            if (const auto julia = find_julia_executable(); not julia.empty())
                julia_executable_ = make_native_argument(julia.string());

            julia_script_path_ = make_native_argument(
              (root / "tools" / "julia" / "generate_experiment_plan.jl")
                .string());
            julia_request_json_path_ =
              make_native_argument((root / "experiment_request.json").string());
            julia_plan_json_path_ =
              make_native_argument((root / "experiment_plan.json").string());
            julia_generation_message_ = "Repository absolute paths selected.";
            has_last_julia_test_exit_code_ = false;
            last_julia_test_succeeded_ = false;
            update_julia_path_status();
        } else {
            julia_generation_message_ =
              "Repository root not found from current working directory.";
        }
    }

    ImGui::SameLine();

    if (ImGui::Button("Detect Julia executable")) {
        if (const auto julia = find_julia_executable(); not julia.empty()) {
            julia_executable_ = make_native_argument(julia.string());
            julia_generation_message_ = "Julia executable detected.";
            has_last_julia_test_exit_code_ = false;
            last_julia_test_succeeded_ = false;
        } else {
            julia_generation_message_ =
              "Julia executable not detected. Enter absolute julia.exe path.";
        }
        update_julia_path_status();
    }

    ImGui::SameLine();

    if (ImGui::Button("Test Julia")) {
        last_julia_raw_command_.clear();
        last_julia_system_command_.clear();
        last_julia_command_.clear();
        last_julia_test_exit_code_ = 0;
        has_last_julia_test_exit_code_ = false;
        last_julia_test_succeeded_ = false;
        update_julia_path_status();

        if (julia_executable_.empty()) {
            julia_generation_message_ =
              "Julia executable cannot be executed from Irritator.";
        } else if (not is_bare_command(julia_executable_) and
                   not julia_executable_exists_) {
            julia_generation_message_ =
              "Julia executable cannot be executed from Irritator.";
        } else {
            last_julia_raw_command_ =
              make_raw_julia_command(julia_executable_, { "--version" });
            last_julia_system_command_ =
              make_system_command(last_julia_raw_command_);
            last_julia_command_ = last_julia_system_command_;

            // Test isole de Julia, sans generation de plan ni simulation.
            const auto exit_code =
              std::system(last_julia_system_command_.c_str());
            last_julia_test_exit_code_ = exit_code;
            has_last_julia_test_exit_code_ = true;
            last_julia_test_succeeded_ = exit_code == 0;

            log_julia_command(app,
                              exit_code == 0 ? log_level::info
                                             : log_level::error,
                              "Julia test",
                              last_julia_raw_command_,
                              last_julia_system_command_,
                              cwd,
                              exit_code);

            if (last_julia_test_succeeded_)
                julia_generation_message_ =
                  "Julia executable can be executed from Irritator.";
            else
                julia_generation_message_ =
                  "Julia executable cannot be executed from Irritator.";
        }
    }

    bool julia_paths_changed = false;
    julia_paths_changed |= input_string<256>("Julia executable",
                                             julia_executable_);
    julia_paths_changed |= input_string<512>("Julia script",
                                             julia_script_path_);
    julia_paths_changed |= input_string<512>("Request JSON",
                                             julia_request_json_path_);
    julia_paths_changed |= input_string<512>("Output plan JSON",
                                             julia_plan_json_path_);

    if (julia_paths_changed) {
        has_last_julia_test_exit_code_ = false;
        last_julia_test_succeeded_ = false;
    }

    update_julia_path_status();
    show_executable_status(
      "Julia executable:", julia_executable_, julia_executable_exists_);
    show_file_status("Julia script:", julia_script_exists_);
    show_file_status("Request JSON:", julia_request_json_exists_);
    show_file_status("Output plan JSON:", julia_plan_json_exists_);

    if (ImGui::Button("Export Request")) {
        if (export_request_to_path(app, julia_request_json_path_)) {
            julia_generation_message_ = "Experiment request exported.";
            update_julia_path_status();
        }
    }

    ImGui::SameLine();

    if (ImGui::Button("Generate Experiment Plan")) {
        last_julia_command_.clear();
        last_julia_raw_command_.clear();
        last_julia_system_command_.clear();
        last_julia_exit_code_     = 0;
        has_last_julia_exit_code_ = false;

        update_julia_path_status();

        if (julia_executable_.empty() or julia_script_path_.empty() or
            julia_request_json_path_.empty() or julia_plan_json_path_.empty()) {
            julia_generation_message_ =
              "Julia executable, script, request and output paths are required.";
            app.jn.push(log_level::error, [](auto& title, auto& msg) noexcept {
                title = "Experiment Request Editor";
                msg   = "Julia plan generation path is empty";
            });
        } else if (not is_bare_command(julia_executable_) and
                   not julia_executable_exists_) {
            julia_generation_message_ = "Julia executable not found.";
            app.jn.push(log_level::error, [](auto& title, auto& msg) noexcept {
                title = "Experiment Request Editor";
                msg   = "Julia executable not found";
            });
        } else if (export_request_to_path(app, julia_request_json_path_)) {
            update_julia_path_status();

            if (not julia_script_exists_) {
                julia_generation_message_ = "Julia script not found";
                app.jn.push(log_level::error,
                            [](auto& title, auto& msg) noexcept {
                                title = "Experiment Request Editor";
                                msg   = "Julia script not found";
                            });
                return;
            }

            if (not julia_request_json_exists_) {
                julia_generation_message_ = "Request JSON was not created.";
                app.jn.push(log_level::error,
                            [](auto& title, auto& msg) noexcept {
                                title = "Experiment Request Editor";
                                msg   = "Request JSON was not created";
                            });
                return;
            }

            std::error_code ec;
            const auto plan_path =
              std::filesystem::path{ make_native_argument(
                julia_plan_json_path_) };
            std::filesystem::remove(plan_path, ec);
            ec.clear();
            update_julia_path_status();

            last_julia_raw_command_ = make_raw_julia_command(
              julia_executable_,
              { julia_script_path_,
                julia_request_json_path_,
                julia_plan_json_path_ });
            last_julia_system_command_ =
              make_system_command(last_julia_raw_command_);
            last_julia_command_ = last_julia_system_command_;

            // Appel synchrone volontaire pour ce premier outil experimental.
            // Aucune simulation Irritator n'est lancee ici.
            const auto exit_code =
              std::system(last_julia_system_command_.c_str());
            last_julia_exit_code_ = exit_code;
            has_last_julia_exit_code_ = true;

            log_julia_command(app,
                              exit_code == 0 ? log_level::info
                                             : log_level::error,
                              "Julia plan generation",
                              last_julia_raw_command_,
                              last_julia_system_command_,
                              cwd,
                              exit_code);

            const auto plan_exists = std::filesystem::exists(plan_path, ec);
            auto       plan_size   = 0ull;

            if (plan_exists and not ec)
                plan_size = static_cast<unsigned long long>(
                  std::filesystem::file_size(plan_path, ec));

            update_julia_path_status();

            if (exit_code == 0 and plan_exists and not ec and plan_size > 0u) {
                julia_generation_message_ =
                  "Experiment plan generated successfully.";
                app.jn.push(log_level::info,
                            [](auto& title, auto& msg) noexcept {
                                title = "Experiment Request Editor";
                                msg   = "Experiment plan generated";
                            });
            } else {
                if (exit_code != 0 and last_julia_test_succeeded_)
                    julia_generation_message_ =
                      "Julia works, but plan generation failed. Check script "
                      "or input JSON.";
                else if (exit_code != 0)
                    julia_generation_message_ =
                      "Julia executable not found or command failed.";
                else
                    julia_generation_message_ =
                      "Experiment plan was not created";

                if (exit_code != 0 and not plan_exists)
                    julia_generation_message_ +=
                      " Experiment plan was not created.";

                app.jn.push(log_level::error,
                            [&](auto& title, auto& msg) noexcept {
                                title = "Experiment Request Editor";
                                format(msg,
                                       "Julia executable not found or command "
                                       "failed. Exit code: {}",
                                       exit_code);
                            });
            }
        }
    }

    if (has_last_julia_exit_code_)
        ImGui::Text("Last command exit code: %d", last_julia_exit_code_);
    else
        ImGui::TextUnformatted("Last command exit code: <none>");

    if (has_last_julia_test_exit_code_)
        ImGui::Text("Last Julia test exit code: %d",
                    last_julia_test_exit_code_);
    else
        ImGui::TextUnformatted("Last Julia test exit code: <none>");

    if (not last_julia_raw_command_.empty())
        ImGui::TextWrapped("Raw command: %s",
                           last_julia_raw_command_.c_str());
    else
        ImGui::TextUnformatted("Raw command: <none>");

    if (not last_julia_system_command_.empty())
        ImGui::TextWrapped("Command passed to system: %s",
                           last_julia_system_command_.c_str());
    else
        ImGui::TextUnformatted("Command passed to system: <none>");

    if (not last_julia_command_.empty())
        ImGui::TextWrapped("Last command: %s", last_julia_command_.c_str());
    else
        ImGui::TextUnformatted("Last command: <none>");

    if (not julia_generation_message_.empty())
        ImGui::TextWrapped("%s", julia_generation_message_.c_str());
}

void experiment_request_editor::show_export_dialog(application& app)
{
    if (not export_dialog_requested_)
        return;

    const char*              title = "Select experiment request export path";
    const std::u8string_view default_filename = u8"experiment_request.json";
    const char8_t*           filters[] = { u8".json", nullptr };

    ImGui::OpenPopup(title);

    if (app.f_dialog.show_save_file(title, default_filename, filters)) {
        if (app.f_dialog.state == file_dialog::status::ok) {
            last_export_path_ = app.f_dialog.result;

            if (write_experiment_request_json(last_export_path_, request_)) {
                app.jn.push(log_level::info, [](auto& title, auto& msg) noexcept {
                    title = "Experiment Request Editor";
                    msg   = "Experiment request JSON exported";
                });
            } else {
                app.jn.push(log_level::error,
                            [](auto& title, auto& msg) noexcept {
                                title = "Experiment Request Editor";
                                msg   = "Failed to export experiment request "
                                      "JSON";
                            });
            }
        }

        app.f_dialog.clear();
        export_dialog_requested_ = false;
    }
}

} // namespace irt
