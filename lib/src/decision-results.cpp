// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#include <irritator/decision-results.hpp>
#include <irritator/file.hpp>

#include <rapidjson/document.h>
#include <rapidjson/filereadstream.h>
#include <rapidjson/rapidjson.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <sstream>
#include <unordered_set>
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

bool read_int_member(const value_type& object,
                     const char*       name,
                     int&              out) noexcept
{
    const auto* value = find_member(object, name);
    if (not value or not value->IsInt())
        return false;

    out = value->GetInt();
    return true;
}

bool read_best_value(const value_type& object, decision_best_value& out)
{
    if (not object.IsObject())
        return false;

    return read_string_member(object, "experiment_id", out.experiment_id) and
           read_double_member(object, "value", out.value);
}

bool read_global_statistics(const value_type& object,
                            decision_global_statistics& out) noexcept
{
    if (not object.IsObject())
        return false;

    return read_double_member(object, "mean_final_B", out.mean_final_B) and
           read_double_member(object,
                              "mean_cumulative_catch",
                              out.mean_cumulative_catch) and
           read_double_member(object, "min_final_B", out.min_final_B) and
           read_double_member(object, "max_final_B", out.max_final_B);
}

bool read_analysis(const value_type& object, decision_analysis& out)
{
    if (not object.IsObject())
        return false;

    if (not read_int_member(object, "experiment_count", out.experiment_count))
        return false;

    if (const auto* best_final = find_member(object, "best_final_B");
        not best_final or not read_best_value(*best_final, out.best_final_B))
        return false;

    if (const auto* best_catch = find_member(object, "best_cumulative_catch");
        not best_catch or
        not read_best_value(*best_catch, out.best_cumulative_catch))
        return false;

    if (const auto* global_stats = find_member(object, "global_statistics");
        not global_stats or
        not read_global_statistics(*global_stats, out.global_statistics))
        return false;

    return true;
}

bool read_ranking_entry(const value_type& value,
                        decision_ranking_entry& out)
{
    if (not value.IsObject())
        return false;

    return read_int_member(value, "rank", out.rank) and
           read_string_member(value, "experiment_id", out.experiment_id) and
           read_double_member(value, "score", out.score) and
           read_double_member(value, "final_B", out.final_B) and
           read_double_member(value,
                              "cumulative_catch",
                              out.cumulative_catch);
}

bool read_ranking(const value_type&                  value,
                  std::vector<decision_ranking_entry>& out)
{
    if (not value.IsArray())
        return false;

    out.clear();
    for (const auto& item : value.GetArray()) {
        decision_ranking_entry entry;
        if (not read_ranking_entry(item, entry))
            return false;

        out.push_back(std::move(entry));
    }

    return true;
}

bool is_finite(const double value) noexcept
{
    return std::isfinite(value);
}

bool has_valid_best_value(const decision_best_value& value) noexcept
{
    return not value.experiment_id.empty() and is_finite(value.value);
}

bool has_valid_global_statistics(
  const decision_global_statistics& stats) noexcept
{
    return is_finite(stats.mean_final_B) and
           is_finite(stats.mean_cumulative_catch) and
           is_finite(stats.min_final_B) and is_finite(stats.max_final_B);
}

} // namespace

expected<decision_results> read_decision_results_json(
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

        decision_results results;

        if (not read_string_member(doc, "request_id", results.request_id))
            return new_error(json_errc::invalid_format);

        if (not read_string_member(doc, "plan_id", results.plan_id))
            return new_error(json_errc::invalid_format);

        if (const auto* analysis = find_member(doc, "analysis");
            not analysis or not read_analysis(*analysis, results.analysis))
            return new_error(json_errc::invalid_format);

        if (const auto* ranking = find_member(doc, "ranking");
            not ranking or not read_ranking(*ranking, results.ranking))
            return new_error(json_errc::invalid_format);

        return results;
    } catch (...) {
        return new_error(json_errc::memory_error);
    }
}

bool is_valid(const decision_results& results) noexcept
{
    if (results.request_id.empty())
        return false;

    if (results.plan_id.empty())
        return false;

    if (results.analysis.experiment_count < 0)
        return false;

    if (results.ranking.empty())
        return false;

    if (results.analysis.experiment_count !=
        static_cast<int>(results.ranking.size()))
        return false;

    if (not has_valid_best_value(results.analysis.best_final_B))
        return false;

    if (not has_valid_best_value(results.analysis.best_cumulative_catch))
        return false;

    if (not has_valid_global_statistics(results.analysis.global_statistics))
        return false;

    if (results.analysis.global_statistics.min_final_B >
        results.analysis.global_statistics.max_final_B)
        return false;

    std::unordered_set<int> ranks;
    ranks.reserve(results.ranking.size());

    for (const auto& entry : results.ranking) {
        if (entry.rank <= 0)
            return false;

        if (entry.rank > static_cast<int>(results.ranking.size()))
            return false;

        if (not ranks.insert(entry.rank).second)
            return false;

        if (entry.experiment_id.empty())
            return false;

        if (not is_finite(entry.score))
            return false;

        if (not is_finite(entry.final_B))
            return false;

        if (not is_finite(entry.cumulative_catch))
            return false;
    }

    return true;
}

std::string validation_report(const decision_results& results)
{
    std::ostringstream out;

    if (results.request_id.empty())
        out << "- request_id est vide\n";

    if (results.plan_id.empty())
        out << "- plan_id est vide\n";

    if (results.analysis.experiment_count < 0)
        out << "- analysis.experiment_count doit etre positif ou nul\n";

    if (results.ranking.empty())
        out << "- ranking est vide\n";

    if (results.analysis.experiment_count !=
        static_cast<int>(results.ranking.size()))
        out << "- analysis.experiment_count ne correspond pas a ranking.size\n";

    if (results.analysis.best_final_B.experiment_id.empty())
        out << "- analysis.best_final_B.experiment_id est vide\n";

    if (not is_finite(results.analysis.best_final_B.value))
        out << "- analysis.best_final_B.value doit etre fini\n";

    if (results.analysis.best_cumulative_catch.experiment_id.empty())
        out << "- analysis.best_cumulative_catch.experiment_id est vide\n";

    if (not is_finite(results.analysis.best_cumulative_catch.value))
        out << "- analysis.best_cumulative_catch.value doit etre fini\n";

    const auto& stats = results.analysis.global_statistics;
    if (not is_finite(stats.mean_final_B))
        out << "- global_statistics.mean_final_B doit etre fini\n";

    if (not is_finite(stats.mean_cumulative_catch))
        out << "- global_statistics.mean_cumulative_catch doit etre fini\n";

    if (not is_finite(stats.min_final_B))
        out << "- global_statistics.min_final_B doit etre fini\n";

    if (not is_finite(stats.max_final_B))
        out << "- global_statistics.max_final_B doit etre fini\n";

    if (stats.min_final_B > stats.max_final_B)
        out << "- global_statistics.min_final_B doit etre <= max_final_B\n";

    std::unordered_set<int> ranks;
    ranks.reserve(results.ranking.size());

    for (const auto& entry : results.ranking) {
        if (entry.rank <= 0)
            out << "- une entree ranking a un rang non positif\n";

        if (entry.rank > static_cast<int>(results.ranking.size()))
            out << "- une entree ranking a un rang hors limites\n";

        if (not ranks.insert(entry.rank).second)
            out << "- le rang " << entry.rank << " est duplique\n";

        if (entry.experiment_id.empty())
            out << "- une entree ranking a un experiment_id vide\n";

        if (not is_finite(entry.score))
            out << "- ranking[" << entry.rank << "].score doit etre fini\n";

        if (not is_finite(entry.final_B))
            out << "- ranking[" << entry.rank << "].final_B doit etre fini\n";

        if (not is_finite(entry.cumulative_catch))
            out << "- ranking[" << entry.rank
                << "].cumulative_catch doit etre fini\n";
    }

    auto report = out.str();
    return report.empty() ? std::string{ "Decision results valide." }
                          : report;
}

const decision_ranking_entry* best_ranked_experiment(
  const decision_results& results) noexcept
{
    if (results.ranking.empty())
        return nullptr;

    return &results.ranking.front();
}

} // namespace irt
