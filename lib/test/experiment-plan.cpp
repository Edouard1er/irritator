// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#include <irritator/experiment-plan.hpp>

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

int main()
{
    using namespace boost::ut;

    "experiment-plan-read-valid-json"_test = [] {
        const auto path =
          std::filesystem::current_path() / "experiment_plan_test.json";

        const std::string json = R"json({
  "request_id": "req_001",
  "plan_id": "plan_req_001",
  "model": "SchaeferBiomass",
  "simulation": {
    "t0": 0.0,
    "horizon": 50.0,
    "dt": 0.1
  },
  "experiments": [
    {
      "id": "e_001",
      "parameters": {
        "r": 0.45,
        "K": 1000.0,
        "q": 0.001,
        "n": 35.2
      },
      "initial_states": {
        "B": 500.0
      }
    },
    {
      "id": "e_002",
      "parameters": {
        "r": 0.45,
        "K": 1000.0,
        "q": 0.001,
        "n": 120.0
      },
      "initial_states": {
        "B": 500.0
      }
    }
  ],
  "state_variables_to_record": [
    "B"
  ],
  "outputs_to_record": [
    "catch"
  ]
})json";

        std::error_code ec;
        std::filesystem::remove(path, ec);
        write_text_file(path, json);

        const auto result = irt::read_experiment_plan_json(path);
        expect(result.has_value());
        if (not result)
            return;

        const auto& plan = result.value();

        expect(eq(plan.request_id, std::string{ "req_001" }));
        expect(eq(plan.plan_id, std::string{ "plan_req_001" }));
        expect(eq(plan.model_name, std::string{ "SchaeferBiomass" }));
        expect(eq(plan.simulation.horizon, 50.0));
        expect(eq(plan.simulation.dt, 0.1));
        expect(eq(plan.experiments.size(), std::size_t{ 2 }));

        const auto n_it = plan.experiments[0].parameters.find("n");
        expect(n_it != plan.experiments[0].parameters.end());

        const auto b_it = plan.experiments[0].initial_states.find("B");
        expect(b_it != plan.experiments[0].initial_states.end());
        if (b_it != plan.experiments[0].initial_states.end())
            expect(eq(b_it->second, 500.0));

        expect(irt::is_valid(plan));

        std::filesystem::remove(path, ec);
    };

    "experiment-plan-validation-empty-experiments"_test = [] {
        const auto path =
          std::filesystem::current_path() / "experiment_plan_empty_test.json";

        const std::string json = R"json({
  "request_id": "req_001",
  "plan_id": "plan_req_001",
  "model": "SchaeferBiomass",
  "simulation": {
    "t0": 0.0,
    "horizon": 50.0,
    "dt": 0.1
  },
  "experiments": [],
  "state_variables_to_record": [
    "B"
  ],
  "outputs_to_record": [
    "catch"
  ]
})json";

        std::error_code ec;
        std::filesystem::remove(path, ec);
        write_text_file(path, json);

        const auto result = irt::read_experiment_plan_json(path);
        expect(result.has_value());
        if (not result)
            return;

        const auto& plan = result.value();

        expect(not irt::is_valid(plan));

        const auto report = irt::validation_report(plan);
        expect(report.find("experiments") != std::string::npos);

        std::filesystem::remove(path, ec);
    };
}
