// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#include <irritator/experiment-request.hpp>
#include <irritator/file.hpp>

#include <rapidjson/filewritestream.h>
#include <rapidjson/prettywriter.h>
#include <rapidjson/rapidjson.h>

#include <array>
#include <cstdio>
#include <sstream>

namespace irt {

static bool has_empty_name(const std::vector<fixed_parameter>& values) noexcept
{
    for (const auto& value : values)
        if (value.name.empty())
            return true;

    return false;
}

static bool has_invalid_variable_parameter(
  const std::vector<variable_parameter>& values) noexcept
{
    for (const auto& value : values)
        if (value.name.empty() or value.min > value.max)
            return true;

    return false;
}

static bool has_empty_name(const std::vector<initial_state>& values) noexcept
{
    for (const auto& value : values)
        if (value.name.empty())
            return true;

    return false;
}

static bool has_empty_name(const std::vector<std::string>& values) noexcept
{
    for (const auto& value : values)
        if (value.empty())
            return true;

    return false;
}

bool is_valid(const experiment_request& request) noexcept
{
    if (request.request_id.empty())
        return false;

    if (request.model_name.empty())
        return false;

    if (request.simulation.horizon <= 0.0)
        return false;

    if (request.simulation.dt <= 0.0)
        return false;

    if (request.simulation.dt > request.simulation.horizon)
        return false;

    if (request.simulation.number_of_simulations <= 0)
        return false;

    if (has_empty_name(request.fixed_parameters))
        return false;

    if (has_invalid_variable_parameter(request.variable_parameters))
        return false;

    if (has_empty_name(request.initial_states))
        return false;

    if (has_empty_name(request.state_variables_to_record))
        return false;

    if (request.generation.type.empty())
        return false;

    return true;
}

std::string validation_report(const experiment_request& request)
{
    std::ostringstream out;

    if (request.request_id.empty())
        out << "- request_id est vide\n";

    if (request.model_name.empty())
        out << "- model_name est vide\n";

    if (request.simulation.horizon <= 0.0)
        out << "- simulation.horizon doit etre strictement positif\n";

    if (request.simulation.dt <= 0.0)
        out << "- simulation.dt doit etre strictement positif\n";

    if (request.simulation.dt > request.simulation.horizon)
        out << "- simulation.dt doit etre inferieur ou egal a horizon\n";

    if (request.simulation.number_of_simulations <= 0)
        out << "- simulation.number_of_simulations doit etre positif\n";

    for (const auto& value : request.fixed_parameters)
        if (value.name.empty())
            out << "- un fixed_parameter a un nom vide\n";

    for (const auto& value : request.variable_parameters) {
        if (value.name.empty())
            out << "- un variable_parameter a un nom vide\n";

        if (value.min > value.max)
            out << "- variable_parameter '" << value.name
                << "' doit verifier min <= max\n";
    }

    for (const auto& value : request.initial_states)
        if (value.name.empty())
            out << "- un initial_state a un nom vide\n";

    for (const auto& name : request.state_variables_to_record)
        if (name.empty())
            out << "- une variable d'etat a enregistrer a un nom vide\n";

    if (request.generation.type.empty())
        out << "- generation.type est vide\n";

    auto report = out.str();
    return report.empty() ? std::string{ "Requete valide." } : report;
}

template<typename Writer>
static void write_string(Writer& writer, const std::string& value) noexcept
{
    writer.String(value.c_str(),
                  static_cast<rapidjson::SizeType>(value.size()));
}

template<typename Writer>
static void write_string_array(Writer&                         writer,
                               const std::vector<std::string>& values) noexcept
{
    writer.StartArray();
    for (const auto& value : values)
        write_string(writer, value);
    writer.EndArray();
}

template<typename Writer>
static void write_fixed_parameters(
  Writer&                              writer,
  const std::vector<fixed_parameter>&  values) noexcept
{
    writer.StartObject();
    for (const auto& value : values) {
        writer.Key(value.name.c_str(),
                   static_cast<rapidjson::SizeType>(value.name.size()));
        writer.Double(value.value);
    }
    writer.EndObject();
}

template<typename Writer>
static void write_variable_parameters(
  Writer&                                 writer,
  const std::vector<variable_parameter>&  values) noexcept
{
    writer.StartObject();
    for (const auto& value : values) {
        writer.Key(value.name.c_str(),
                   static_cast<rapidjson::SizeType>(value.name.size()));
        writer.StartObject();
        writer.Key("distribution");
        write_string(writer, value.distribution);
        writer.Key("min");
        writer.Double(value.min);
        writer.Key("max");
        writer.Double(value.max);
        writer.EndObject();
    }
    writer.EndObject();
}

template<typename Writer>
static void write_initial_states(Writer&                          writer,
                                 const std::vector<initial_state>& values) noexcept
{
    writer.StartObject();
    for (const auto& value : values) {
        writer.Key(value.name.c_str(),
                   static_cast<rapidjson::SizeType>(value.name.size()));
        writer.Double(value.value);
    }
    writer.EndObject();
}

template<typename Writer>
static void write_request(Writer& writer, const experiment_request& request)
  noexcept
{
    writer.StartObject();

    writer.Key("request_id");
    write_string(writer, request.request_id);

    writer.Key("model");
    write_string(writer, request.model_name);

    writer.Key("simulation");
    writer.StartObject();
    writer.Key("t0");
    writer.Double(request.simulation.t0);
    writer.Key("horizon");
    writer.Double(request.simulation.horizon);
    writer.Key("dt");
    writer.Double(request.simulation.dt);
    writer.Key("number_of_simulations");
    writer.Int(request.simulation.number_of_simulations);
    writer.EndObject();

    writer.Key("fixed_parameters");
    write_fixed_parameters(writer, request.fixed_parameters);

    writer.Key("variable_parameters");
    write_variable_parameters(writer, request.variable_parameters);

    writer.Key("initial_states");
    write_initial_states(writer, request.initial_states);

    writer.Key("state_variables_to_record");
    write_string_array(writer, request.state_variables_to_record);

    writer.Key("outputs_to_record");
    write_string_array(writer, request.outputs_to_record);

    writer.Key("generation_method");
    writer.StartObject();
    writer.Key("type");
    write_string(writer, request.generation.type);
    writer.Key("seed");
    writer.Uint64(request.generation.seed);
    writer.EndObject();

    writer.EndObject();
}

status write_experiment_request_json(
  const std::filesystem::path& path,
  const experiment_request&    request) noexcept
{
    if (not is_valid(request))
        return new_error(json_errc::arg_error);

    auto output = file::open(path, file_mode{ file_open_options::write });
    if (not output)
        return new_error(file_errc::open_error);

    std::array<char, 4096> buffer{};
    rapidjson::FileWriteStream os(
      output->to_file(), buffer.data(), buffer.size());

    rapidjson::PrettyWriter<rapidjson::FileWriteStream,
                            rapidjson::UTF8<>,
                            rapidjson::UTF8<>,
                            rapidjson::CrtAllocator,
                            rapidjson::kWriteNanAndInfFlag>
      writer(os);

    writer.SetIndent(' ', 2);
    write_request(writer, request);
    output->flush();

    return success();
}

} // namespace irt
