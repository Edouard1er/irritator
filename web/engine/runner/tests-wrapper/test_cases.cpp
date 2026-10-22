#include "fixtures.hpp"

#include <algorithm>
#include <cmath>
#include <iostream>
#include <limits>

namespace wrapper_test {
void advanced_case(const std::string&);
namespace {
void near(double value, double expected, const std::string& context)
{
    require(std::isfinite(value) && std::abs(value - expected) < 1e-9,
            context + ": got " + std::to_string(value) + ", expected " + std::to_string(expected));
}

using histories = std::vector<std::vector<std::array<double, 2>>>;
histories history(fixture& f, std::size_t occurrence)
{
    auto& resource = f.parent.sim.sims.get(f.bindings.at(occurrence).resource);
    const auto x = f.prospective.targets.at("system/X").model;
    histories ret;
    for (const auto id : resource.embedded_sims) {
        const auto* observation = resource.embedded_sims.get<irt::embedded_simulation::simulation_observation>(id).get(x);
        require(observation != nullptr, "Missing scenario observation");
        std::vector<std::array<double, 2>> values;
        for (const auto point : observation->values) values.push_back({point.t, point.value});
        ret.push_back(std::move(values));
    }
    return ret;
}

void audit_scenarios(fixture& f, bool coupled)
{
    auto& resource = f.parent.sim.sims.get(f.bindings.front().resource);
    const std::string prefix = coupled ? "system/" : "";
    const auto u = f.prospective.targets.at(prefix + "u").model;
    const auto x = f.prospective.targets.at(prefix + "X").model;
    std::size_t index = 0;
    for (const auto id : resource.embedded_sims) {
        auto& sim = resource.embedded_sims.get<irt::simulation>(id);
        const double rate = f.plan.factors.front().values.at(index++);
        require(&sim != &resource.sim, "Scenario engine must own separate storage");
        require(&sim.parameters[u] != &resource.sim.parameters[u], "Scenario parameters must be private");
        near(sim.parameters[u].reals[0], rate, "Scenario factor");
        near(sim.current_time(), 2, "Child horizon");
        const auto* obs = resource.embedded_sims.get<irt::embedded_simulation::simulation_observation>(id).get(x);
        require(obs && !obs->values.empty(), "Scenario has observed X");
        double previous = -1;
        for (const auto sample : obs->values) {
            require(sample.t > previous && sample.t <= 2, "Ordered bounded child history");
            previous = sample.t;
            near(sample.value, 1 + rate * sample.t, "Analytic affine trajectory");
        }
        near(obs->values.back().t, 2, "Terminal observation date");
        near(obs->compute_result(irt::criteria_type::max_last), 1 + 2 * rate, "Native max_last");
        near(obs->compute_result(irt::criteria_type::min_last), 1 + 2 * rate, "Native min_last");
        near(obs->compute_result(irt::criteria_type::min), std::min(1., 1 + 2 * rate), "Native minimum");
        near(obs->compute_result(irt::criteria_type::max), std::max(1., 1 + 2 * rate), "Native maximum");
        if (coupled) {
            const auto monitor = f.prospective.targets.at("monitor").model;
            require(irt::get_dyn<irt::counter>(sim.models.get(monitor)).event_number > 0,
                    "Prospective coupled output is connected to its parent monitor");
        }
        std::cout << "SCENARIO rate=" << rate << " terminal=" << obs->values.back().value
                  << " minimum=" << obs->compute_result(irt::criteria_type::min) << '\n';
    }
    require(index == f.plan.factors.front().values.size(), "All scenarios inspected");
}

void rebind(fixture& f, experiment_spec plan)
{
    f.edit([&](auto& ids) {
        f.bindings.front() = bind_wrapper(f.parent.sim, f.bindings.front().wrapper,
                                         ids, f.prospective, plan);
        release_unreferenced_resources(f.parent.sim);
    });
    f.plan = plan;
    f.occurrence_plans.front() = std::move(plan);
}

void pair_case(bool reset)
{
    auto f = make_pair(reset);
    const auto left_id = f->bindings[0].resource, right_id = f->bindings[1].resource;
    require(left_id != right_id, "Distinct resources per occurrence");
    f->initialize();
    auto& left = f->parent.sim.sims.get(left_id);
    auto& right = f->parent.sim.sims.get(right_id);
    require(left.embedded_sims.size() == 3 && right.embedded_sims.size() == 2,
            "Different scenario cardinalities");
    const auto u = f->prospective.targets.at("system/u").model;
    const auto x = f->prospective.targets.at("system/X").model;
    const auto fl = *left.factors.begin(), fr = *right.factors.begin();
    require(left.factors.get<irt::fixed_factor>(fl).values.data() != right.factors.get<irt::fixed_factor>(fr).values.data(),
            "Factor lists have independent storage");
    const auto first_l = *left.embedded_sims.begin(), first_r = *right.embedded_sims.begin();
    auto& sl = left.embedded_sims.get<irt::simulation>(first_l);
    auto& sr = right.embedded_sims.get<irt::simulation>(first_r);
    require(&sl.models.get(x) != &sr.models.get(x) && &sl.parameters[u] != &sr.parameters[u],
            "Model and parameter storage independent");
    sl.parameters[u].reals[2] = 42;
    near(sr.parameters[u].reals[2], 0, "Sibling parameters unchanged by mutation");
    sl.parameters[u].reals[2] = 0;
    // Pause after left computed its campaign and before the right trigger.
    while (left.pending_responses.empty()) { require(f->calls < 30, "Left response must become pending"); f->step(); }
    require(left.pending_responses.size() == 1 && right.pending_responses.empty(), "Private pending response queues");
    for (const auto id : right.embedded_sims) near(right.embedded_sims.get<irt::simulation>(id).current_time(), 0, "Right clock unaffected");
    require(history(*f, 1).front().empty(), "Right observations unaffected by left run");
    while (f->events.size() < 6) { require(f->calls < 40, "Pair response budget"); f->step(); }
    const auto before_reset = history(*f, 1);
    const auto left_before_reset = history(*f, 0);
    f->finish();
    require(f->events.size() == (reset ? 9u : 6u), "Independent response event counts");
    for (int i = 0; i < 2; ++i) {
        std::vector<output_event> events;
        for (const auto& event : f->events) if (event.wrapper == f->bindings[i].wrapper) events.push_back(event);
        require(events.size() == (reset && i == 0 ? 6u : 3u), "Per-wrapper output count");
        const std::array expected{i == 0 ? 3. : 5., 1., i == 0 ? 1. : 2.};
        for (int p = 0; p < 3; ++p) {
            near(events[p].time, 2, "Simultaneous response date");
            near(events[p].value[0], expected[p], "Per-wrapper decision");
            const auto& w = irt::get_dyn<irt::simulation_wrapper>(f->parent.sim.models.get(f->bindings[i].wrapper));
            require(w.y[p] == f->ports[i][p], "Coupled wrapper ports preserved");
            const std::string name = i == 0 ? "left" : "right";
            const auto& sink = irt::get_dyn<irt::counter>(f->parent.sim.models.get(f->parent_targets.at(name + "Sink" + std::to_string(p)).model));
            require(sink.event_number == (reset && i == 0 ? 2u : 1u), "Parent receives independent messages");
            near(sink.last_value, reset && i == 0 ? (p == 2 ? -2. : -3.) : expected[p], "Parent last value");
            if (reset && i == 0) {
                near(events[p + 3].time, 2.75, "Reset response time");
                near(events[p + 3].value[0], p == 2 ? -2. : -3., "Reset decision");
            }
        }
    }
    require(before_reset == history(*f, 1), "Right history unchanged by left reset/finalize");
    if (reset) require(left_before_reset != history(*f, 0), "Left reset replaces its history");
    const auto first_events = f->events;
    // Reset parent preserves resource ownership and rebuilds its campaigns.
    f->initialize();
    require(f->parent.sim.sims.size() == 2 && f->bindings[0].resource == left_id && f->bindings[1].resource == right_id,
            "Parent reset preserves private resource identifiers");
    require(history(*f, 0).front().empty() && history(*f, 1).front().empty(), "Parent reset clears observations");
    f->finish();
    require(f->events.size() == (reset ? 9u : 6u), "Repeated initialize remains executable");
    for (std::size_t i = 0; i < f->events.size(); ++i) {
        const auto& event = f->events[i];
        const auto& expected = first_events[i];
        require(event.wrapper == expected.wrapper && event.port == expected.port &&
                event.time == expected.time && event.value == expected.value,
                "Parent initialize must reproduce every decision (restoring the configured plan)");
    }
    require(before_reset == history(*f, 1), "Right deterministic history reproduced after parent reset");
    std::cout << "PAIR scenarios=3,2 resources=2 reset=" << reset << " events=" << f->events.size() << '\n';
}

void invalid_cases()
{
    auto f = make_affine(true);
    int rejected = 0;
    auto reject = [&](const char* name, const auto& mutate) {
        auto plan = f->plan;
        mutate(plan);
        bool failed = false;
        f->edit([&](auto& ids) {
            const auto& prospective = ids.sim_components.get(f->prospective.simulation).pj;
            try { (void)validate_experiment(prospective, f->prospective.targets, plan); }
            catch (const std::runtime_error& error) { failed = true; std::cout << "REJECT " << name << ": " << error.what() << '\n'; }
        });
        require(failed, std::string("Invalid configuration accepted: ") + name);
        require(f->parent.sim.sims.get(f->bindings[0].resource).embedded_sims.empty(), "Reject before scenario allocation");
        ++rejected;
    };
    reject("F=0", [](auto& p) { p.factors.clear(); });
    reject("F=11", [](auto& p) { p.factors.resize(11, p.factors[0]); });
    reject("S=0", [](auto& p) { p.selections.clear(); });
    reject("F+S=2", [](auto& p) { p.selections.resize(1); });
    reject("F+S=13", [](auto& p) { p.selections.resize(12, p.selections[0]); });
    reject("empty factor", [](auto& p) { p.factors[0].values.clear(); });
    reject("nonfinite factor", [](auto& p) { p.factors[0].values[0] = std::numeric_limits<double>::infinity(); });
    reject("NaN factor", [](auto& p) { p.factors[0].values[0] = std::numeric_limits<double>::quiet_NaN(); });
    reject("duplicate target", [](auto& p) { auto factor = p.factors[0]; factor.id = "again"; p.factors.push_back(factor); });
    reject("foreign factor", [](auto& p) { p.factors[0].target = "parent/run"; });
    reject("missing selection", [](auto& p) { p.selections[0].target = "system/missing"; });
    reject("real slot 1", [](auto& p) { p.factors[0].real_slot = 1; });
    reject("duplicate selection", [](auto& p) { p.selections[1].id = p.selections[0].id; });
    reject("invalid criterion", [](auto& p) { p.selections[0].criterion = static_cast<irt::criteria_type>(255); });
    reject("invalid primary", [](auto& p) { p.primary = "missing"; });
    reject("weighted method", [](auto& p) { p.method = irt::optimization_method::weighted_sum; });
    reject("epsilon method", [](auto& p) { p.method = irt::optimization_method::epsilon_constrained; });
    reject("invalid method", [](auto& p) { p.method = static_cast<irt::optimization_method>(255); });
    reject("invalid direction", [](auto& p) { p.direction = static_cast<irt::optimization_type>(255); });
    reject("invalid mode", [](auto& p) { p.mode = static_cast<irt::simulation_wrapper::run_type>(255); });
    reject("random count zero", [](auto& p) { p.factors[0].type = irt::factor_type::random; p.factors[0].random.count = 0; });
    reject("single cardinality", [](auto& p) { p.factors[0].type = irt::factor_type::single; });
    reject("scenario budget", [](auto& p) { p.max_scenarios = 2; });
    reject("zero budget", [](auto& p) { p.max_scenarios = 0; });
    reject("cartesian budget", [](auto& p) { p.factors.push_back({"initial", "system/X", {1, 2, 3}}); p.max_scenarios = 8; });
    f->edit([&](auto& ids) {
        auto& pj = ids.sim_components.get(f->prospective.simulation).pj;
        auto targets = f->prospective.targets;
        targets.at("system/u").model = irt::undefined<irt::model_id>();
        bool failed = false;
        try { (void)validate_experiment(pj, targets, f->plan); } catch (const std::runtime_error&) { failed = true; }
        require(failed, "Foreign local model_id accepted");
        const auto begin = pj.sim.limits.begin(), end = pj.sim.limits.end();
        pj.sim.limits.set_bound(0, std::numeric_limits<double>::infinity());
        failed = false;
        try { (void)validate_experiment(pj, f->prospective.targets, f->plan); } catch (const std::runtime_error&) { failed = true; }
        require(failed, "Infinite complete horizon accepted");
        pj.sim.limits.set_bound(begin, end);
    });
    auto& parameters = f->parent.sim.parameters[f->bindings[0].wrapper];
    const auto old = parameters.integers[irt::simulation_wrapper_tag::id];
    parameters.integers[irt::simulation_wrapper_tag::id] = 0;
    bool failed = false;
    try { validate_binding(f->parent.sim, f->bindings[0], f->plan); } catch (const std::runtime_error&) { failed = true; }
    require(failed, "Parameter/dynamics id mismatch accepted");
    parameters.integers[irt::simulation_wrapper_tag::id] = old;
    f->initialize();
    failed = false;
    try { rebind(*f, f->plan); } catch (const std::runtime_error&) { failed = true; }
    require(failed, "Rebinding a live wrapper accepted");
    f->finish();
    std::cout << "INVALID rejected=" << rejected + 4 << '\n';
}
} // namespace

void run_case(const std::string& name)
{
    if (name == "flat" || name == "coupled" || name == "creation") {
        const bool coupled = name == "coupled";
        auto f = make_affine(coupled);
        const auto& binding = f->bindings.front();
        require(binding.after_set.complete == !coupled && binding.after_copy.complete == !coupled,
                "Explicit audit of native copy resolution");
        std::cout << "COPY_AUDIT after_set=" << binding.after_set.complete << " after_copy=" << binding.after_copy.complete
                  << " factors=" << binding.after_copy.factors << " selections=" << binding.after_copy.selections << '\n';
        f->initialize(); f->finish(); verify(*f, 3, 1, 1); audit_scenarios(*f, coupled);
    } else if (name == "pair" || name == "reset") pair_case(name == "reset");
    else if (name == "invalid") invalid_cases();
    else if (name == "criteria") {
        auto f = make_affine();
        auto p = f->plan; p.primary = "minimum";
        rebind(*f, p); f->initialize(); f->finish(); verify(*f, 1, 1, 0);
        auto g = make_affine();
        p = g->plan; p.direction = irt::optimization_type::minimize;
        rebind(*g, p); g->initialize(); g->finish(); verify(*g, -1, -1, -1);
    } else if (name == "single") {
        auto plan = affine_plan(); plan.factors[0].type = irt::factor_type::single; plan.factors[0].values = {2};
        auto f = make_affine(false, plan); f->initialize(); f->finish(); verify(*f, 5, 1, 2);
    } else if (name == "atomic") {
        auto plan = affine_plan(); for (auto& s : plan.selections) s.target = "u";
        auto f = make_affine(false, plan, true); f->initialize(); f->finish(); verify(*f, 1, 1, 1);
        require(f->prospective.targets.size() == 1, "Genuine single-atom prospective project");
    } else if (name == "ports") {
        auto plan = affine_plan(); plan.factors.push_back({"initial", "X", {1, 2}});
        while (plan.selections.size() < 10) plan.selections.push_back({"extra" + std::to_string(plan.selections.size()), "X", irt::criteria_type::max_last});
        auto f = make_affine(false, plan); f->initialize(); f->finish();
        const auto& w = irt::get_dyn<irt::simulation_wrapper>(f->parent.sim.models.get(f->bindings[0].wrapper));
        require(w.x.size() == 4 && w.y.size() == 12 && f->events.size() == 12, "Dynamic 4/12 ports at native output limit");
        for (int port = 0; port < 12; ++port) {
            const auto expected = port == 1 ? 2. : port == 10 ? 1. : port == 11 ? 2. : 4.;
            near(f->events[port].value[0], expected, "Dynamic output layout");
            require(w.y[port] == f->ports[0][port], "Dynamic connections preserved");
            const auto& sink = irt::get_dyn<irt::counter>(f->parent.sim.models.get(f->parent_targets.at("sink" + std::to_string(port)).model));
            require(sink.event_number == 1, "Every dynamic output received");
            near(sink.last_value, expected, "Dynamic receiver value");
        }
    } else if (name == "resources") {
        auto& memory = irt::new_delete_memory_resource::instance();
        const auto initial = memory.get_memory_usage();
        const auto balance = initial.first - initial.second;
        for (int cycle = 0; cycle < 6; ++cycle) {
            { auto f = make_pair(cycle % 2 == 0); f->initialize(); f->finish(); }
            const auto now = memory.get_memory_usage();
            require(now.first - now.second == balance, "Native allocations leaked after occurrence destruction");
            std::cout << "MEMORY cycle=" << cycle << " outstanding=" << now.first - now.second << '\n';
        }
    } else advanced_case(name);
}
} // namespace wrapper_test
