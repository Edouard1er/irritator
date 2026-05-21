// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#include <irritator/decision-results.hpp>

#include <boost/ut.hpp>

#include <filesystem>
#include <fstream>
#include <string>

static void write_text_file(const std::filesystem::path& path,
                            const std::string&           content)
{
    std::ofstream output(path, std::ios::binary);
    output << content;
}

static auto valid_decision_results_json() -> std::string
{
    return R"json({
  "request_id": "req_test",
  "plan_id": "plan_req_test",
  "analysis": {
    "experiment_count": 2,
    "best_final_B": {
      "experiment_id": "e_002",
      "value": 650.0
    },
    "best_cumulative_catch": {
      "experiment_id": "e_001",
      "value": 10.0
    },
    "global_statistics": {
      "mean_final_B": 575.0,
      "mean_cumulative_catch": 8.5,
      "min_final_B": 500.0,
      "max_final_B": 650.0
    }
  },
  "ranking": [
    {
      "rank": 1,
      "experiment_id": "e_001",
      "score": 0.5,
      "final_B": 500.0,
      "cumulative_catch": 10.0
    },
    {
      "rank": 2,
      "experiment_id": "e_002",
      "score": 0.5,
      "final_B": 650.0,
      "cumulative_catch": 7.0
    }
  ]
})json";
}

int main()
{
    using namespace boost::ut;

    "decision-results-read-valid-json"_test = [] {
        const auto path =
          std::filesystem::current_path() / "decision_results_test.json";

        std::error_code ec;
        std::filesystem::remove(path, ec);
        write_text_file(path, valid_decision_results_json());

        const auto result = irt::read_decision_results_json(path);
        expect(result.has_value());
        if (not result)
            return;

        const auto& decisions = result.value();

        expect(eq(decisions.request_id, std::string{ "req_test" }));
        expect(eq(decisions.plan_id, std::string{ "plan_req_test" }));
        expect(eq(decisions.ranking.size(), std::size_t{ 2 }));
        expect(eq(decisions.ranking.front().score, 0.5));
        expect(eq(decisions.analysis.best_final_B.experiment_id,
                  std::string{ "e_002" }));
        expect(eq(decisions.analysis.best_final_B.value, 650.0));
        expect(eq(decisions.analysis.best_cumulative_catch.experiment_id,
                  std::string{ "e_001" }));
        expect(eq(decisions.analysis.best_cumulative_catch.value, 10.0));

        expect(irt::is_valid(decisions));
        expect(eq(irt::validation_report(decisions),
                  std::string{ "Decision results valide." }));

        const auto* best = irt::best_ranked_experiment(decisions);
        expect(best != nullptr);
        if (best)
            expect(eq(best->experiment_id, std::string{ "e_001" }));

        std::filesystem::remove(path, ec);
    };

    "decision-results-invalid-json"_test = [] {
        const auto path =
          std::filesystem::current_path() / "decision_results_invalid.json";

        std::error_code ec;
        std::filesystem::remove(path, ec);
        write_text_file(path, "{ invalid json");

        const auto result = irt::read_decision_results_json(path);
        expect(result.has_error());

        std::filesystem::remove(path, ec);
    };

    "decision-results-empty-ranking-invalid"_test = [] {
        const auto path =
          std::filesystem::current_path() / "decision_results_empty.json";

        const auto json = R"json({
  "request_id": "req_test",
  "plan_id": "plan_req_test",
  "analysis": {
    "experiment_count": 0,
    "best_final_B": {
      "experiment_id": "e_002",
      "value": 650.0
    },
    "best_cumulative_catch": {
      "experiment_id": "e_001",
      "value": 10.0
    },
    "global_statistics": {
      "mean_final_B": 575.0,
      "mean_cumulative_catch": 8.5,
      "min_final_B": 500.0,
      "max_final_B": 650.0
    }
  },
  "ranking": []
})json";

        std::error_code ec;
        std::filesystem::remove(path, ec);
        write_text_file(path, json);

        const auto result = irt::read_decision_results_json(path);
        expect(result.has_value());
        if (not result)
            return;

        expect(not irt::is_valid(result.value()));

        const auto report = irt::validation_report(result.value());
        expect(report.find("ranking est vide") != std::string::npos);

        std::filesystem::remove(path, ec);
    };

    "decision-results-nan-score-invalid"_test = [] {
        const auto path =
          std::filesystem::current_path() / "decision_results_nan.json";

        auto json = valid_decision_results_json();
        const auto needle = std::string{ "\"score\": 0.5" };
        const auto pos    = json.find(needle);
        expect(pos != std::string::npos);
        if (pos != std::string::npos)
            json.replace(pos, needle.size(), "\"score\": NaN");

        std::error_code ec;
        std::filesystem::remove(path, ec);
        write_text_file(path, json);

        const auto result = irt::read_decision_results_json(path);
        expect(result.has_value());
        if (not result)
            return;

        expect(not irt::is_valid(result.value()));

        const auto report = irt::validation_report(result.value());
        expect(report.find("score") != std::string::npos);

        std::filesystem::remove(path, ec);
    };

    "decision-results-empty-experiment-id-invalid"_test = [] {
        const auto path =
          std::filesystem::current_path() / "decision_results_empty_id.json";

        auto json = valid_decision_results_json();
        const auto needle = std::string{ "\"experiment_id\": \"e_001\"" };
        const auto pos    = json.find(needle);
        expect(pos != std::string::npos);
        if (pos != std::string::npos)
            json.replace(pos, needle.size(), "\"experiment_id\": \"\"");

        std::error_code ec;
        std::filesystem::remove(path, ec);
        write_text_file(path, json);

        const auto result = irt::read_decision_results_json(path);
        expect(result.has_value());
        if (not result)
            return;

        expect(not irt::is_valid(result.value()));

        const auto report = irt::validation_report(result.value());
        expect(report.find("experiment_id") != std::string::npos);

        std::filesystem::remove(path, ec);
    };
}
