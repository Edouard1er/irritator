// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#include <irritator/experiment-request.hpp>

#include <boost/ut.hpp>

#include <filesystem>
#include <fstream>
#include <string>

static auto read_text_file(const std::filesystem::path& path) -> std::string
{
    std::ifstream input(path, std::ios::binary);
    return std::string(std::istreambuf_iterator<char>{ input },
                       std::istreambuf_iterator<char>{});
}

int main()
{
    using namespace boost::ut;

    "experiment-request-export-json"_test = [] {
        irt::experiment_request request;
        request.request_id = "request-001";
        request.model_name = "fishery";

        request.simulation.t0                    = 0.0;
        request.simulation.horizon               = 50.0;
        request.simulation.dt                    = 0.1;
        request.simulation.number_of_simulations = 100;

        request.fixed_parameters.push_back({ "r", 0.45 });
        request.fixed_parameters.push_back({ "K", 1000.0 });

        request.variable_parameters.push_back({ "n", "uniform", 20.0, 200.0 });

        request.initial_states.push_back({ "B", 500.0 });

        request.state_variables_to_record.push_back("B");
        request.outputs_to_record.push_back("catch");

        request.generation.type = "latin_hypercube";
        request.generation.seed = 12345u;

        expect(irt::is_valid(request));

        const auto path =
          std::filesystem::current_path() / "experiment_request_test.json";

        std::error_code ec;
        std::filesystem::remove(path, ec);

        const auto ret = irt::write_experiment_request_json(path, request);

        expect(ret.has_value());
        expect(std::filesystem::exists(path));

        const auto content = read_text_file(path);
        expect(content.find("\"request_id\"") != std::string::npos);
        expect(content.find("\"request-001\"") != std::string::npos);
        expect(content.find("\"model\"") != std::string::npos);
        expect(content.find("\"fishery\"") != std::string::npos);
        expect(content.find("\"latin_hypercube\"") != std::string::npos);
        expect(content.find("\"catch\"") != std::string::npos);

        std::filesystem::remove(path, ec);
    };
}
