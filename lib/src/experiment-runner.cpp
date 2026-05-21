// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#include <irritator/experiment-runner.hpp>
#include <irritator/file.hpp>

#include <rapidjson/filewritestream.h>
#include <rapidjson/prettywriter.h>
#include <rapidjson/rapidjson.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <limits>

namespace irt {
namespace {

expected<double> read_required_value(
  const std::map<std::string, double>& values,
  const char*                          name) noexcept
{
    const auto it = values.find(name);
    if (it == values.end())
        return new_error(experiment_runner_errc::missing_parameter);

    if (not std::isfinite(it->second))
        return new_error(experiment_runner_errc::invalid_value);

    return it->second;
}

expected<double> read_required_initial_state(
  const std::map<std::string, double>& values,
  const char*                          name) noexcept
{
    const auto it = values.find(name);
    if (it == values.end())
        return new_error(experiment_runner_errc::missing_initial_state);

    if (not std::isfinite(it->second))
        return new_error(experiment_runner_errc::invalid_value);

    return it->second;
}

bool is_valid_simulation(
  const experiment_plan_simulation_settings& simulation) noexcept
{
    return std::isfinite(simulation.t0) and
           std::isfinite(simulation.horizon) and
           std::isfinite(simulation.dt) and simulation.dt > 0.0 and
           simulation.horizon > 0.0 and simulation.horizon >= simulation.t0;
}

bool is_safe_parameter_set(const double r,
                           const double K,
                           const double q,
                           const double n,
                           const double B) noexcept
{
    return std::isfinite(r) and std::isfinite(K) and std::isfinite(q) and
           std::isfinite(n) and std::isfinite(B) and K != 0.0;
}

double schaefer_derivative(const double B,
                           const double r,
                           const double K,
                           const double q,
                           const double n) noexcept
{
    return r * B * (1.0 - B / K) - q * n * B;
}

double schaefer_catch(const double B,
                      const double q,
                      const double n) noexcept
{
    return q * n * B;
}

template<typename Writer>
void write_string(Writer& writer, const std::string& value) noexcept
{
    writer.String(value.c_str(),
                  static_cast<rapidjson::SizeType>(value.size()));
}

template<typename Writer>
void write_trajectory_values(Writer& writer,
                             const std::vector<double>& values) noexcept
{
    writer.StartArray();
    for (const auto value : values)
        writer.Double(value);
    writer.EndArray();
}

template<typename Writer>
void write_result(Writer& writer, const experiment_result& result) noexcept
{
    writer.StartObject();

    writer.Key("experiment_id");
    write_string(writer, result.experiment_id);

    writer.Key("summary");
    writer.StartObject();
    writer.Key("final_B");
    writer.Double(result.summary.final_B);
    writer.Key("min_B");
    writer.Double(result.summary.min_B);
    writer.Key("max_B");
    writer.Double(result.summary.max_B);
    writer.Key("mean_B");
    writer.Double(result.summary.mean_B);
    writer.Key("cumulative_catch");
    writer.Double(result.summary.cumulative_catch);
    writer.EndObject();

    writer.Key("trajectories");
    writer.StartObject();
    writer.Key("time");
    write_trajectory_values(writer, result.biomass_trajectory.time);
    writer.Key("B");
    write_trajectory_values(writer, result.biomass_trajectory.values);
    writer.Key("catch");
    write_trajectory_values(writer, result.catch_trajectory.values);
    writer.EndObject();

    writer.EndObject();
}

template<typename Writer>
void write_results(Writer& writer, const experiment_run_results& results)
  noexcept
{
    writer.StartObject();

    writer.Key("request_id");
    write_string(writer, results.request_id);

    writer.Key("plan_id");
    write_string(writer, results.plan_id);

    writer.Key("results");
    writer.StartArray();
    for (const auto& result : results.results)
        write_result(writer, result);
    writer.EndArray();

    writer.EndObject();
}

} // namespace

expected<experiment_result> run_schaefer_experiment(
  const experiment_row&                      row,
  const experiment_plan_simulation_settings& simulation) noexcept
{
    if (not is_valid_simulation(simulation))
        return new_error(experiment_runner_errc::invalid_simulation);

    const auto r = read_required_value(row.parameters, "r");
    if (r.has_error())
        return r.error();

    const auto K = read_required_value(row.parameters, "K");
    if (K.has_error())
        return K.error();

    const auto q = read_required_value(row.parameters, "q");
    if (q.has_error())
        return q.error();

    const auto n = read_required_value(row.parameters, "n");
    if (n.has_error())
        return n.error();

    const auto B0 = read_required_initial_state(row.initial_states, "B");
    if (B0.has_error())
        return B0.error();

    if (not is_safe_parameter_set(*r, *K, *q, *n, *B0))
        return new_error(experiment_runner_errc::invalid_value);

    experiment_result result;
    result.experiment_id = row.id;

    const auto duration = simulation.horizon - simulation.t0;
    const auto reserve_size =
      static_cast<std::size_t>(std::floor(duration / simulation.dt)) + 2u;

    result.biomass_trajectory.time.reserve(reserve_size);
    result.biomass_trajectory.values.reserve(reserve_size);
    result.catch_trajectory.time.reserve(reserve_size);
    result.catch_trajectory.values.reserve(reserve_size);

    auto t = simulation.t0;
    auto B = *B0;

    auto sum_B            = 0.0;
    auto min_B            = B;
    auto max_B            = B;
    auto cumulative_catch = 0.0;

    auto push_state = [&]() noexcept {
        const auto catch_value = schaefer_catch(B, *q, *n);

        result.biomass_trajectory.time.push_back(t);
        result.biomass_trajectory.values.push_back(B);
        result.catch_trajectory.time.push_back(t);
        result.catch_trajectory.values.push_back(catch_value);

        min_B = std::min(min_B, B);
        max_B = std::max(max_B, B);
        sum_B += B;

        return std::isfinite(catch_value);
    };

    if (not push_state())
        return new_error(experiment_runner_errc::numerical_error);

    constexpr auto epsilon = 1e-12;

    while (t + epsilon < simulation.horizon) {
        const auto step = std::min(simulation.dt, simulation.horizon - t);
        const auto catch_value = schaefer_catch(B, *q, *n);
        const auto dB = schaefer_derivative(B, *r, *K, *q, *n);
        const auto next_B = B + step * dB;

        if (not std::isfinite(step) or step <= 0.0 or
            not std::isfinite(catch_value) or not std::isfinite(dB) or
            not std::isfinite(next_B))
            return new_error(experiment_runner_errc::numerical_error);

        cumulative_catch += catch_value * step;
        t += step;
        B = next_B;

        if (not push_state())
            return new_error(experiment_runner_errc::numerical_error);
    }

    const auto count =
      static_cast<double>(result.biomass_trajectory.values.size());

    result.summary.final_B = result.biomass_trajectory.values.empty()
                               ? 0.0
                               : result.biomass_trajectory.values.back();
    result.summary.min_B            = min_B;
    result.summary.max_B            = max_B;
    result.summary.mean_B           = count > 0.0 ? sum_B / count : 0.0;
    result.summary.cumulative_catch = cumulative_catch;

    return result;
}

expected<experiment_run_results> run_experiment_plan(
  const experiment_plan& plan) noexcept
{
    if (not is_valid(plan))
        return new_error(experiment_runner_errc::invalid_value);

    experiment_run_results results;
    results.request_id = plan.request_id;
    results.plan_id    = plan.plan_id;
    results.results.reserve(plan.experiments.size());

    for (const auto& experiment : plan.experiments) {
        auto result = run_schaefer_experiment(experiment, plan.simulation);
        if (result.has_error())
            return result.error();

        results.results.push_back(std::move(result).value());
    }

    return results;
}

status write_experiment_results_json(
  const std::filesystem::path&  path,
  const experiment_run_results& results) noexcept
{
    if (path.empty())
        return new_error(experiment_runner_errc::file_error);

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
    write_results(writer, results);
    output->flush();

    return success();
}

} // namespace irt
