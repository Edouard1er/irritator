// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#include <irritator/experiment-runner.hpp>

#include <boost/ut.hpp>

#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>

static auto read_text_file(const std::filesystem::path& path) -> std::string
{
    std::ifstream input(path, std::ios::binary);
    return std::string(std::istreambuf_iterator<char>{ input },
                       std::istreambuf_iterator<char>{});
}

static auto make_valid_plan() -> irt::experiment_plan
{
    irt::experiment_plan plan;

    plan.request_id = "req_runner";
    plan.plan_id    = "plan_req_runner";
    plan.model_name = "SchaeferBiomass";

    plan.simulation.t0      = 0.0;
    plan.simulation.horizon = 1.0;
    plan.simulation.dt      = 0.1;

    plan.experiments.push_back({
      "e_001",
      { { "r", 0.45 }, { "K", 1000.0 }, { "q", 0.001 }, { "n", 35.2 } },
      { { "B", 500.0 } },
    });

    plan.experiments.push_back({
      "e_002",
      { { "r", 0.45 }, { "K", 1000.0 }, { "q", 0.001 }, { "n", 120.0 } },
      { { "B", 500.0 } },
    });

    plan.state_variables_to_record.push_back("B");
    plan.outputs_to_record.push_back("catch");

    return plan;
}

int main()
{
    using namespace boost::ut;

    "experiment-runner-schaefer-plan"_test = [] {
        const auto plan = make_valid_plan();

        const auto results = irt::run_experiment_plan(plan);
        expect(results.has_value());
        if (not results)
            return;

        expect(eq(results->request_id, std::string{ "req_runner" }));
        expect(eq(results->plan_id, std::string{ "plan_req_runner" }));
        expect(eq(results->results.size(), std::size_t{ 2 }));

        for (const auto& result : results->results) {
            expect(not result.experiment_id.empty());
            expect(result.biomass_trajectory.time.size() >= std::size_t{ 2 });
            expect(eq(result.biomass_trajectory.time.size(),
                      result.biomass_trajectory.values.size()));
            expect(eq(result.catch_trajectory.time.size(),
                      result.catch_trajectory.values.size()));
            expect(eq(result.biomass_trajectory.time.size(),
                      result.catch_trajectory.time.size()));
            expect(result.summary.final_B > 0.0);
            expect(result.summary.max_B >= result.summary.min_B);
            expect(result.summary.cumulative_catch >= 0.0);
        }

        const auto path =
          std::filesystem::current_path() / "experiment_results.json";

        std::error_code ec;
        std::filesystem::remove(path, ec);

        const auto write_status =
          irt::write_experiment_results_json(path, results.value());

        expect(write_status.has_value());
        expect(std::filesystem::exists(path));

        const auto content = read_text_file(path);
        expect(content.find("\"request_id\"") != std::string::npos);
        expect(content.find("\"req_runner\"") != std::string::npos);
        expect(content.find("\"experiment_id\"") != std::string::npos);
        expect(content.find("\"summary\"") != std::string::npos);
        expect(content.find("\"trajectories\"") != std::string::npos);
        expect(content.find("\"cumulative_catch\"") != std::string::npos);

        std::filesystem::remove(path, ec);
    };

    "experiment-runner-missing-parameter"_test = [] {
        auto plan = make_valid_plan();
        plan.experiments[0].parameters.erase("n");

        const auto results = irt::run_experiment_plan(plan);
        expect(results.has_error());
    };
}
