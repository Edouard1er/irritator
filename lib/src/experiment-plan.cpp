// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#include <irritator/experiment-plan.hpp>
#include <irritator/file.hpp>

#include <rapidjson/document.h>
#include <rapidjson/filereadstream.h>
#include <rapidjson/rapidjson.h>

#include <array>
#include <sstream>
#include <utility>

namespace irt {
namespace {

using value_type = rapidjson::Value;

const value_type* find_member(const value_type& object, const char* name)
{
    if (not object.IsObject())
        return nullptr;

    const auto it = object.FindMember(name);
    if (it == object.MemberEnd())
        return nullptr;

    return &it->value;
}

bool read_string_member(const value_type& object,
                        const char*       name,
                        std::string&      out)
{
    const auto* value = find_member(object, name);
    if (not value or not value->IsString())
        return false;

    out.assign(value->GetString(), value->GetStringLength());
    return true;
}

bool read_double_member(const value_type& object,
                        const char*       name,
                        double&           out) noexcept
{
    const auto* value = find_member(object, name);
    if (not value or not value->IsNumber())
        return false;

    out = value->GetDouble();
    return true;
}

bool read_string_array(const value_type&          value,
                       std::vector<std::string>& out)
{
    if (not value.IsArray())
        return false;

    out.clear();
    for (const auto& item : value.GetArray()) {
        if (not item.IsString())
            return false;

        out.emplace_back(item.GetString(), item.GetStringLength());
    }

    return true;
}

bool read_number_map(const value_type&                 value,
                     std::map<std::string, double>&    out)
{
    if (not value.IsObject())
        return false;

    out.clear();
    for (auto it = value.MemberBegin(), end = value.MemberEnd(); it != end;
         ++it) {
        if (not it->name.IsString() or not it->value.IsNumber())
            return false;

        out.emplace(std::string{ it->name.GetString(),
                                 it->name.GetStringLength() },
                    it->value.GetDouble());
    }

    return true;
}

bool read_simulation(const value_type& object,
                     experiment_plan_simulation_settings& simulation) noexcept
{
    const auto* value = find_member(object, "simulation");
    if (not value or not value->IsObject())
        return false;

    return read_double_member(*value, "t0", simulation.t0) &&
           read_double_member(*value, "horizon", simulation.horizon) &&
           read_double_member(*value, "dt", simulation.dt);
}

bool read_experiment_row(const value_type& value, experiment_row& out)
{
    if (not value.IsObject())
        return false;

    if (not read_string_member(value, "id", out.id))
        return false;

    if (const auto* parameters = find_member(value, "parameters");
        not parameters or not read_number_map(*parameters, out.parameters))
        return false;

    if (const auto* initial_states = find_member(value, "initial_states");
        not initial_states or
        not read_number_map(*initial_states, out.initial_states))
        return false;

    return true;
}

bool read_experiments(const value_type&           value,
                      std::vector<experiment_row>& out)
{
    if (not value.IsArray())
        return false;

    out.clear();
    for (const auto& item : value.GetArray()) {
        experiment_row row;
        if (not read_experiment_row(item, row))
            return false;

        out.push_back(std::move(row));
    }

    return true;
}

bool has_empty_name(const std::map<std::string, double>& values) noexcept
{
    for (const auto& [name, _] : values) {
        (void)_;
        if (name.empty())
            return true;
    }

    return false;
}

bool has_empty_name(const std::vector<std::string>& values) noexcept
{
    for (const auto& value : values)
        if (value.empty())
            return true;

    return false;
}

} // namespace

expected<experiment_plan> read_experiment_plan_json(
  const std::filesystem::path& path) noexcept
{
    try {
        auto input = file::open(path, file_mode{ file_open_options::read });
        if (not input)
            return input.error();

        std::array<char, 4096> buffer{};
        rapidjson::FileReadStream stream(
          input->to_file(), buffer.data(), buffer.size());

        rapidjson::Document doc;
        doc.ParseStream<rapidjson::kParseNanAndInfFlag>(stream);

        if (doc.HasParseError() or not doc.IsObject())
            return new_error(json_errc::invalid_format);

        experiment_plan plan;

        if (not read_string_member(doc, "request_id", plan.request_id))
            return new_error(json_errc::invalid_format);

        if (not read_string_member(doc, "plan_id", plan.plan_id))
            return new_error(json_errc::invalid_format);

        if (not read_string_member(doc, "model", plan.model_name))
            return new_error(json_errc::invalid_format);

        if (not read_simulation(doc, plan.simulation))
            return new_error(json_errc::invalid_format);

        if (const auto* experiments = find_member(doc, "experiments");
            not experiments or not read_experiments(*experiments,
                                                    plan.experiments))
            return new_error(json_errc::invalid_format);

        if (const auto* states =
              find_member(doc, "state_variables_to_record");
            not states or
            not read_string_array(*states, plan.state_variables_to_record))
            return new_error(json_errc::invalid_format);

        if (const auto* outputs = find_member(doc, "outputs_to_record");
            not outputs or
            not read_string_array(*outputs, plan.outputs_to_record))
            return new_error(json_errc::invalid_format);

        return plan;
    } catch (...) {
        return new_error(json_errc::memory_error);
    }
}

bool is_valid(const experiment_plan& plan) noexcept
{
    if (plan.request_id.empty())
        return false;

    if (plan.plan_id.empty())
        return false;

    if (plan.model_name.empty())
        return false;

    if (plan.simulation.horizon <= 0.0)
        return false;

    if (plan.simulation.dt <= 0.0)
        return false;

    if (plan.simulation.dt > plan.simulation.horizon)
        return false;

    if (plan.experiments.empty())
        return false;

    for (const auto& experiment : plan.experiments) {
        if (experiment.id.empty())
            return false;

        if (experiment.parameters.empty())
            return false;

        if (has_empty_name(experiment.parameters))
            return false;

        if (has_empty_name(experiment.initial_states))
            return false;
    }

    if (plan.state_variables_to_record.empty())
        return false;

    if (has_empty_name(plan.state_variables_to_record))
        return false;

    if (has_empty_name(plan.outputs_to_record))
        return false;

    return true;
}

std::string validation_report(const experiment_plan& plan)
{
    std::ostringstream out;

    if (plan.request_id.empty())
        out << "- request_id est vide\n";

    if (plan.plan_id.empty())
        out << "- plan_id est vide\n";

    if (plan.model_name.empty())
        out << "- model_name est vide\n";

    if (plan.simulation.horizon <= 0.0)
        out << "- simulation.horizon doit etre strictement positif\n";

    if (plan.simulation.dt <= 0.0)
        out << "- simulation.dt doit etre strictement positif\n";

    if (plan.simulation.dt > plan.simulation.horizon)
        out << "- simulation.dt doit etre inferieur ou egal a horizon\n";

    if (plan.experiments.empty())
        out << "- experiments est vide\n";

    for (const auto& experiment : plan.experiments) {
        if (experiment.id.empty())
            out << "- une experience a un id vide\n";

        if (experiment.parameters.empty())
            out << "- l'experience '" << experiment.id
                << "' ne contient aucun parametre\n";

        for (const auto& [name, _] : experiment.parameters) {
            (void)_;
            if (name.empty())
                out << "- l'experience '" << experiment.id
                    << "' contient un parametre sans nom\n";
        }

        for (const auto& [name, _] : experiment.initial_states) {
            (void)_;
            if (name.empty())
                out << "- l'experience '" << experiment.id
                    << "' contient un etat initial sans nom\n";
        }
    }

    if (plan.state_variables_to_record.empty())
        out << "- state_variables_to_record est vide\n";

    for (const auto& name : plan.state_variables_to_record)
        if (name.empty())
            out << "- une variable d'etat a enregistrer a un nom vide\n";

    for (const auto& name : plan.outputs_to_record)
        if (name.empty())
            out << "- une sortie a enregistrer a un nom vide\n";

    auto report = out.str();
    return report.empty() ? std::string{ "Plan d'experience valide." }
                          : report;
}

} // namespace irt
