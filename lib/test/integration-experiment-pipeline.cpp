// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#include <irritator/experiment-plan.hpp>
#include <irritator/experiment-request.hpp>

#include <boost/ut.hpp>

#include <cstdlib>
#include <filesystem>
#include <string>

namespace {

struct cleanup_files {
    std::filesystem::path request_path;
    std::filesystem::path plan_path;

    ~cleanup_files()
    {
        std::error_code ec;
        std::filesystem::remove(request_path, ec);
        std::filesystem::remove(plan_path, ec);
    }
};

bool command_success(const std::string& command)
{
    return std::system(command.c_str()) == 0;
}

std::string quote_argument(const std::filesystem::path& path)
{
    auto value = path.string();
    std::string quoted;
    quoted.reserve(value.size() + 2u);
    quoted.push_back('"');

    for (const auto c : value) {
        if (c == '"')
            quoted.push_back('\\');
        quoted.push_back(c);
    }

    quoted.push_back('"');
    return quoted;
}

std::filesystem::path find_julia_script()
{
    auto current = std::filesystem::current_path();

    for (;;) {
        const auto candidate =
          current / "tools" / "julia" / "generate_experiment_plan.jl";

        if (std::filesystem::exists(candidate))
            return candidate;

        if (not current.has_parent_path() or current == current.parent_path())
            break;

        current = current.parent_path();
    }

    return {};
}

irt::experiment_request make_request()
{
    irt::experiment_request request;
    request.request_id = "req_integration";
    request.model_name = "SchaeferBiomass";

    request.simulation.t0                    = 0.0;
    request.simulation.horizon               = 50.0;
    request.simulation.dt                    = 0.1;
    request.simulation.number_of_simulations = 10;

    request.fixed_parameters.push_back({ "r", 0.45 });
    request.fixed_parameters.push_back({ "K", 1000.0 });
    request.fixed_parameters.push_back({ "q", 0.001 });

    request.variable_parameters.push_back({ "n", "uniform", 20.0, 200.0 });

    request.initial_states.push_back({ "B", 500.0 });

    request.state_variables_to_record.push_back("B");
    request.outputs_to_record.push_back("catch");

    request.generation.type = "random_uniform";
    request.generation.seed = 12345u;

    return request;
}

} // namespace

int main()
{
    using namespace boost::ut;

#if defined(_WIN32)
    const auto julia_probe = std::string{ "julia --version > nul 2> nul" };
#else
    const auto julia_probe = std::string{ "julia --version > /dev/null 2>&1" };
#endif

    if (not command_success(julia_probe)) {
        skip / "integration-experiment-pipeline"_test = [] {
            boost::ut::log << "Julia introuvable dans le PATH: test ignore.\n";
        };
        return 0;
    }

    "integration-experiment-pipeline"_test = [] {
        const auto request_path =
          std::filesystem::current_path() / "integration_experiment_request.json";
        const auto plan_path =
          std::filesystem::current_path() / "integration_experiment_plan.json";
        cleanup_files cleanup{ request_path, plan_path };

        std::error_code ec;
        std::filesystem::remove(request_path, ec);
        std::filesystem::remove(plan_path, ec);

        const auto request = make_request();
        expect(irt::is_valid(request));

        const auto write_status =
          irt::write_experiment_request_json(request_path, request);
        expect(write_status.has_value());
        expect(std::filesystem::exists(request_path));

        const auto script_path = find_julia_script();
        expect((not script_path.empty()) >> fatal);

        const auto command = std::string{ "julia " } +
                             quote_argument(script_path) + " " +
                             quote_argument(request_path) + " " +
                             quote_argument(plan_path);

        // La commande est affichee pour diagnostiquer clairement le pipeline.
        boost::ut::log << "Commande Julia: " << command << '\n';

        const auto exit_code = std::system(command.c_str());
        expect(exit_code == 0);
        if (exit_code != 0)
            return;

        expect(std::filesystem::exists(plan_path));

        const auto plan_size = std::filesystem::file_size(plan_path, ec);
        expect(not ec);
        expect(plan_size > 0u);

        const auto plan_result = irt::read_experiment_plan_json(plan_path);
        expect(plan_result.has_value());
        if (not plan_result)
            return;

        const auto& plan = plan_result.value();

        expect(eq(plan.request_id, std::string{ "req_integration" }));
        expect(eq(plan.model_name, std::string{ "SchaeferBiomass" }));
        expect(eq(plan.experiments.size(), std::size_t{ 10 }));
        expect(eq(plan.simulation.horizon, 50.0));
        expect(eq(plan.simulation.dt, 0.1));

        expect((not plan.experiments.empty()) >> fatal);
        const auto& first = plan.experiments.front();

        expect(first.parameters.find("r") != first.parameters.end());
        expect(first.parameters.find("K") != first.parameters.end());
        expect(first.parameters.find("q") != first.parameters.end());
        expect(first.parameters.find("n") != first.parameters.end());
        expect(first.initial_states.find("B") != first.initial_states.end());

        expect(irt::is_valid(plan));
    };
}
