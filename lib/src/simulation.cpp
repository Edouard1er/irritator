// Copyright (c) 2025 INRAE Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#include <irritator/core.hpp>
#include <irritator/format.hpp>

namespace irt {

/** Fill the observers history vector. */
static void update_observations(simulation& sim) noexcept
{
    if (not sim.immediate_observers.empty())
        sim.tick_resamplers();
}

static status copy_history(
  simulation&                                  sim,
  embedded_simulation::simulation_observation& sim_obs) noexcept
{
    // finalize() has observed the left state at the excluded end boundary.
    // Only an expired simulation may seal its resamplers: a paused one can
    // still receive more bags at its current logical date.
    if (sim.current_time_expired()) {
        for (auto& obs : sim.observers)
            sim.observers.get<resampler>(sim.observers.get_id(obs))
              .tick(obs, time_domain<time>::infinity);
    } else {
        sim.tick_resamplers();
    }

    for (auto& obs : sim.observers) {
        const auto mdl_id = obs.model();
        auto       ok     = true;
        auto*      vec    = sim_obs.get(mdl_id);

        if (debug::check(vec != nullptr)) {
            obs.read_history([&vec, &ok](const auto& h, const auto) {
                if (not vec->values.reserve(h.size())) {
                    ok &= false;
                    return;
                }

                vec->values = h;
            });

            if (not ok)
                return make_error(
                  simulation_errc::simulation_wrapper_not_enough_memory);

            // Preserve an explicit terminal date for deduplicated plateaus.
            // Before the first committed sample (e.g. bag at t=0), provide
            // the current observable state without sealing the resampler.
            // The next copy replaces this snapshot with committed history.
            if ((sim.current_time_expired() or vec->values.empty()) and
                (vec->values.empty() or
                 vec->values.back().t < sim.current_time())) {
                if (not vec->values.reserve(vec->values.size() + 1))
                    return make_error(
                      simulation_errc::simulation_wrapper_not_enough_memory);

                dispatch(sim.models.get(mdl_id), [&](const auto& dyn) {
                    using dynamics = std::remove_cvref_t<decltype(dyn)>;
                    if constexpr (has_observation_function<dynamics>) {
                        const auto t = sim.current_time();
                        const auto s = dyn.observation(
                          t, t - sim.models.get(mdl_id).tl);
                        vec->values.emplace_back(s.t, s.value);
                    }
                });
            }
        }
    }

    return success();
}

static status run_complete(embedded_simulation& embed_sims) noexcept
{
    auto& sims    = embed_sims.embedded_sims.get<simulation>();
    auto& sim_obs = embed_sims.embedded_sims
                      .get<embedded_simulation::simulation_observation>();

    for (const auto id : embed_sims.embedded_sims) {
        const auto idx   = get_index(id);
        auto&      sim   = sims[idx];
        auto&      sim_o = sim_obs[idx];
        auto& progress = embed_sims.embedded_sims.get<embedded_simulation::execution_result>(id);
        using outcome = embedded_simulation::scenario_outcome;

        if (progress.outcome != outcome::success) continue;
        if (embed_sims.execution.max_campaign_run_calls and
            embed_sims.campaign_run_calls >= embed_sims.execution.max_campaign_run_calls) {
            if (not embed_sims.execution.isolate)
                return make_error(simulation_errc::simulation_wrapper_child_budget_error);
            progress.outcome = outcome::canceled;
            irt_check(sim.finalize());
            continue;
        }

        if (sim.current_time_expired())
            continue;

        do {
            if ((embed_sims.execution.max_child_run_calls and
                 progress.run_calls >= embed_sims.execution.max_child_run_calls) or
                (embed_sims.execution.max_campaign_run_calls and
                 embed_sims.campaign_run_calls >= embed_sims.execution.max_campaign_run_calls)) {
                if (not embed_sims.execution.isolate)
                    return make_error(simulation_errc::simulation_wrapper_child_budget_error);
                progress.outcome = outcome::budget_exceeded;
                irt_check(sim.finalize());
                break;
            }
            ++progress.run_calls;
            ++embed_sims.campaign_run_calls;
            // Any run/finalize/copy error remains fatal. A failed scheduler
            // transition is never resumed or assumed safe to finalize.
            irt_check(sim.run());
            update_observations(sim);
        } while (not sim.current_time_expired());

        if (sim.current_time_expired()) {
            irt_check(sim.finalize());
            irt_check(copy_history(sim, sim_o));
        }
    }

    return success();
}

static status run_bag(embedded_simulation& embed_sims) noexcept
{
    auto& sims    = embed_sims.embedded_sims.get<simulation>();
    auto& sim_obs = embed_sims.embedded_sims
                      .get<embedded_simulation::simulation_observation>();

    for (const auto id : embed_sims.embedded_sims) {
        const auto idx   = get_index(id);
        auto&      sim   = sims[idx];
        auto&      sim_o = sim_obs[idx];

        if (sim.current_time_expired())
            continue;

        irt_check(sim.run());
        update_observations(sim);

        if (sim.current_time_expired()) {
            irt_check(sim.finalize());
        }

        irt_check(copy_history(sim, sim_o));
    }

    return success();
}

static status run_time(embedded_simulation& embed_sims) noexcept
{
    auto& sims    = embed_sims.embedded_sims.get<simulation>();
    auto& sim_obs = embed_sims.embedded_sims
                      .get<embedded_simulation::simulation_observation>();

    for (const auto id : embed_sims.embedded_sims) {
        const auto idx   = get_index(id);
        auto&      sim   = sims[idx];
        auto&      sim_o = sim_obs[idx];
        const auto t     = sim.current_time();

        if (sim.current_time_expired())
            continue;

        while (not sim.current_time_expired() and sim.current_time() == t) {
            irt_check(sim.run());
            update_observations(sim);
        }

        if (sim.current_time_expired()) {
            irt_check(sim.finalize());
        }

        irt_check(copy_history(sim, sim_o));
    }

    return success();
}

static status run_until(embedded_simulation& embed_sims,
                        const time           until) noexcept
{
    auto& sims    = embed_sims.embedded_sims.get<simulation>();
    auto& sim_obs = embed_sims.embedded_sims
                      .get<embedded_simulation::simulation_observation>();

    for (const auto id : embed_sims.embedded_sims) {
        const auto idx   = get_index(id);
        auto&      sim   = sims[idx];
        auto&      sim_o = sim_obs[idx];

        if (sim.current_time_expired())
            continue;

        while (not sim.current_time_expired() and sim.current_time() < until) {
            irt_check(sim.run());
            update_observations(sim);
        }

        if (sim.current_time_expired()) {
            irt_check(sim.finalize());
        }

        irt_check(copy_history(sim, sim_o));
    }

    return success();
}

static status run_during(embedded_simulation& embed_sims,
                         const time           during) noexcept
{
    auto& sims    = embed_sims.embedded_sims.get<simulation>();
    auto& sim_obs = embed_sims.embedded_sims
                      .get<embedded_simulation::simulation_observation>();

    for (const auto id : embed_sims.embedded_sims) {
        const auto idx   = get_index(id);
        auto&      sim   = sims[idx];
        auto&      sim_o = sim_obs[idx];
        const auto limit = sim.current_time() + during;

        if (sim.current_time_expired())
            continue;

        while (not sim.current_time_expired() and sim.current_time() < limit) {
            irt_check(sim.run());
            update_observations(sim);
        }

        if (sim.current_time_expired()) {
            irt_check(sim.finalize());
        }

        irt_check(copy_history(sim, sim_o));
    }

    return success();
}

static status embedded_sims_alloc(embedded_simulation& embed_sims,
                                  const sz             nb_sims) noexcept
{
    debug::ensure(nb_sims >= 1);

    embed_sims.embedded_sims.clear();
    if (not embed_sims.embedded_sims.can_alloc(nb_sims) and
        not embed_sims.embedded_sims.grow<2, 1>(nb_sims))
        return make_error(
          simulation_errc::
            simulation_wrapper_too_many_embedded_simulation_error);

    embed_sims.input_parameters.clear();
    if (not embed_sims.input_parameters.reserve(embed_sims.factors.size()))
        return make_error(
          simulation_errc::
            simulation_wrapper_too_many_embedded_simulation_error);

    auto& sims    = embed_sims.embedded_sims.get<simulation>();
    auto& sim_obs = embed_sims.embedded_sims
                      .get<embedded_simulation::simulation_observation>();

    for (sz i = 0; i < nb_sims; ++i) {
        const auto id  = embed_sims.embedded_sims.alloc_id();
        const auto idx = get_index(id);

        sims[idx] = embed_sims.sim;
        embed_sims.embedded_sims.get<embedded_simulation::execution_result>(id) = {};
        sim_obs[idx].data.clear();

        for (const auto sel_id : embed_sims.selections) {
            const auto mdl_id = embed_sims.selections.get<model_id>(sel_id);

            sim_obs[idx].data.emplace_back(
              mdl_id, embedded_simulation::embedded_model_observation{});
        }

        sim_obs[idx].sort();
    }

    return success();
}

static status embedded_sims_copy_parameters_from_plan(
  embedded_simulation& embed_sims,
  const embedded_simulation::dynamic_plan_frame* dynamic = nullptr) noexcept
{
    const auto nb_sims = embed_sims.embedded_sims.size();
    auto&      sims    = embed_sims.embedded_sims.get<simulation>();

    if (std::cmp_not_equal(nb_sims, embed_sims.embedded_sims.size()))
        return make_error(
          simulation_errc::
            simulation_wrapper_embedded_simulation_initialization_error);

    struct parameters {
        factor_id id       = undefined<factor_id>();
        sz        position = 0u;
        sz        count    = 0u;
    };

    embed_sims.input_parameters.resize(embed_sims.factors.size());
    vector<parameters> params(embed_sims.input_parameters.size());

    if (params.capacity() < embed_sims.factors.size() or
        embed_sims.input_parameters.size() < embed_sims.factors.size())
        return make_error(
          simulation_errc::
            simulation_wrapper_embedded_simulation_initialization_error);

    const auto& types  = embed_sims.factors.get<factor_type>();
    const auto& models = embed_sims.factors.get<model_id>();

    sz i = 0;
    for (const auto f_id : embed_sims.factors) {
        const auto f_idx = get_index(f_id);

        auto values = vector<real>{};

        if (dynamic) {
            const auto count = types[f_idx] == factor_type::single
                                 ? 1u : dynamic->cardinalities[i];
            if (not values.resize(count))
                return make_error(simulation_errc::simulation_wrapper_not_enough_memory);
            std::copy_n(dynamic->domains[i].begin(), count, values.begin());
        } else switch (types[f_idx]) {
        case factor_type::single:
        case factor_type::single_add:
        case factor_type::single_mult:
            values.resize(1, embed_sims.factors.get<single_factor>(f_id).value);
            break;

        case factor_type::fixed:
        case factor_type::fixed_add:
        case factor_type::fixed_mult:
            values = embed_sims.factors.get<fixed_factor>(f_id).values;
            break;

        case factor_type::random:
        case factor_type::random_add:
        case factor_type::random_mult:
            values = embed_sims.factors.get<random_factor>(f_id).gen(
              embed_sims.seed);
            break;

        default:
            unreachable();
        }

        params[i].count    = values.size();
        params[i].position = 0;
        params[i].id       = f_id;

        embed_sims.input_parameters[i].mdl_id = models[f_idx];
        embed_sims.input_parameters[i].values = std::move(values);

        ++i;
    }

    dlogln(0, "emedded_sim = {}", embed_sims.embedded_sims.size());
    dlogln(0, "parameters  = {}", embed_sims.input_parameters.size());

    dlog(0, "{:^12}", "subid");
    for (sz i = 0, e = params.size(); i < e; ++i) {
        const auto factor_id = params[i].id;
        const auto name      = embed_sims.factors.get<name_str>(factor_id).sv();
        dlog(0, "{:^12}", name);
    }
    dlog(0, "\n");

    for (const auto id : embed_sims.embedded_sims) {
        dlog(0, "{:^12}", get_index(id));

        // First, copy the multiple parameters values into embedded simulation
        // parameters.

        for (sz i = 0, e = params.size(); i < e; ++i) {
            const auto mdl_id  = embed_sims.input_parameters[i].mdl_id;
            const auto mdl_idx = get_index(mdl_id);

            const auto f_id  = params[i].id;
            const auto type  = embed_sims.factors.get<factor_type>(f_id);
            const auto pos   = params[i].position;
            const auto value = embed_sims.input_parameters[i].values[pos];

            debug::ensure(embed_sims.factors.exists(f_id));

            const auto new_value = [&]() {
                switch (type) {
                case factor_type::single:
                case factor_type::fixed:
                case factor_type::random:
                    return embed_sims.input_parameters[i].value.has_value()
                             ? *embed_sims.input_parameters[i].value
                             : value;

                case factor_type::single_add:
                case factor_type::fixed_add:
                case factor_type::random_add:
                    return value +
                           (embed_sims.input_parameters[i].value.has_value()
                              ? *embed_sims.input_parameters[i].value
                              : 0.0);

                case factor_type::single_mult:
                case factor_type::fixed_mult:
                case factor_type::random_mult:
                    return value *
                           (embed_sims.input_parameters[i].value.has_value()
                              ? *embed_sims.input_parameters[i].value
                              : 1.0);

                default:
                    unreachable();
                }
            }();

            sims[id].parameters[mdl_idx].reals[0] = new_value;

            dlog(0, "{:^12}", new_value);
        }

        dlog(0, "\n");

        // Second we advance the cross product using a pointer into a vector
        // of position. For example for 3 parameters with 3 values:
        // step -> cross-product-vector
        // 0    -> [0 0 0]
        // 1    -> [1 0 0]
        // 2    -> [2 0 0]
        // 3    -> [0 1 0]
        // ...
        // 24    -> [0 2 2]
        // 25    -> [1 2 2]
        // 26    -> [2 2 2]

        sz ptr = 0u;
        do {
            ++params[ptr].position;

            if (params[ptr].position < params[ptr].count)
                break;

            params[ptr].position = 0u;
            ++ptr;
        } while (ptr < params.size());
    }

    dlog(0, "\n");

    return success();
}

static status embedded_sims_copy_parameters(embedded_simulation& resource) noexcept
{
    return embedded_sims_copy_parameters_from_plan(resource, nullptr);
}

static status embedded_sims_init(embedded_simulation& embed_sims) noexcept
{
    embed_sims.campaign_run_calls = 0;
    auto& sims    = embed_sims.embedded_sims.get<simulation>();
    auto& sim_obs = embed_sims.embedded_sims
                      .get<embedded_simulation::simulation_observation>();

    for (const auto id : embed_sims.embedded_sims) {
        const auto idx = get_index(id);
        embed_sims.embedded_sims.get<embedded_simulation::execution_result>(id) = {};

        for (auto i = 0, e = length(sim_obs[idx].data); i != e; ++i)
            sim_obs[idx].data[i].value.values.clear();
    }

    for (const auto id : embed_sims.embedded_sims) {
        const auto idx = get_index(id);
        sims[idx].observers.clear();
        for (auto& mdl : sims[idx].models)
            mdl.obs_id = undefined<observer_id>();

        for (const auto sel_id : embed_sims.selections) {
            const auto mdl_id = embed_sims.selections.get<model_id>(sel_id);
            debug::ensure(sims[idx].models.exists(mdl_id));

            // Several criteria may reduce the same model trajectory. One
            // observer per model is enough; observe() requires it to be new.
            auto& mdl = sims[idx].models.get(mdl_id);
            if (not sims[idx].observers.exists(mdl.obs_id) and
                sims[idx].observe(mdl).has_error())
                return make_error(
                  simulation_errc::simulation_wrapper_embedded_simulation_observation_error);
        }

        if (sims[idx].srcs.prepare().has_error())
            return make_error(
              simulation_errc::
                simulation_wrapper_embedded_simulation_source_error);

        if (sims[idx].initialize().has_error())
            return make_error(
              simulation_errc::
                simulation_wrapper_embedded_simulation_initialization_error);
    }

    return success();
}

simulation_wrapper::simulation_wrapper(const simulation_wrapper& other) noexcept
  : sim_id{ undefined<embedded_simulation_id>() }
  , run{ other.run }
  , scenario_results{ other.scenario_results }
  , dynamic_plan{ other.dynamic_plan }
  , execution_status{ other.execution_status }
  , required_inputs{ other.required_inputs }
{}

auto compute_simulation_number =
  [](const embedded_simulation& embed_sims) noexcept -> sz {
    auto nb = sz{ 1 };

    for (const auto id : embed_sims.factors) {
        switch (embed_sims.factors.get<factor_type>(id)) {
        case factor_type::single:
        case factor_type::single_add:
        case factor_type::single_mult:
            break;

        case factor_type::fixed:
        case factor_type::fixed_add:
        case factor_type::fixed_mult:
            nb *= embed_sims.factors.get<fixed_factor>(id).values.size();
            break;

        case factor_type::random:
        case factor_type::random_add:
        case factor_type::random_mult:
            nb *= embed_sims.factors.get<random_factor>(id).count;
            break;
        }
    }

    return nb;
};

status simulation_wrapper::initialize(simulation& sim) noexcept
{
    sigma = time_domain<time>::infinity;
    state = run_state::uninitialized;
    response_emitted = false;
    campaign = 0;
    last_input_campaign = 0;
    auto* embed_sims = sim.sims.try_to_get(sim_id);

    if (not embed_sims)
        return make_error(simulation_errc::simulation_wrapper_source_error);

    if (x.size() <= 2)
        return make_error(simulation_errc::simulation_wrapper_input_error);

    if (y.size() <= 2)
        return make_error(simulation_errc::simulation_wrapper_output_error);

    const auto nb_sims = compute_simulation_number(*embed_sims);

    if (nb_sims == 0)
        return make_error(simulation_errc::simulation_wrapper_parameter_error);

    embed_sims->embedded_sims.clear();
    embed_sims->pending_responses.clear();
    embed_sims->input_frames.clear();
    embed_sims->dynamic_frames.clear();
    embed_sims->campaign_run_calls = 0;
    if (execution_status != embed_sims->execution.enabled or
        (execution_status and (run != run_type::complete or not scenario_results)) or
        (not execution_status and (embed_sims->execution.isolate or
          embed_sims->execution.collect_only or embed_sims->execution.max_child_run_calls or
          embed_sims->execution.max_campaign_run_calls)))
        return make_error(simulation_errc::simulation_wrapper_parameter_error);
    if (execution_status and
        (x.size() != embed_sims->factors.size() + 2 + (dynamic_plan ? 1 : 0) or
         y.size() != 2 * (embed_sims->factors.size() + embed_sims->selections.size()) +
                       7 + (dynamic_plan ? 1 : 0)))
        return make_error(simulation_errc::simulation_wrapper_parameter_error);
    if (dynamic_plan) {
        const auto factors = embed_sims->factors.size();
        const auto selections = embed_sims->selections.size();
        const auto duration = embed_sims->sim.limits.end() - embed_sims->sim.limits.begin();
        if (factors < 1 or factors > 9 or selections < 1 or factors + selections < 3 or
            factors + selections > 12 or run != run_type::complete or not scenario_results or
            x.size() != factors + 3 or y.size() != 2 * (factors + embed_sims->selections.size()) + 3 + (execution_status ? 5 : 0) or
            nb_sims > 128 or not std::isfinite(duration) or duration <= zero)
            return make_error(simulation_errc::simulation_wrapper_parameter_error);
        unsigned singles = 0;
        sz slot = 0;
        sz bounded_count = 1;
        for (const auto id : embed_sims->factors) {
            const auto type = embed_sims->factors.get<factor_type>(id);
            if (type == factor_type::single) singles |= 1u << slot;
            else if (type != factor_type::fixed)
                return make_error(simulation_errc::simulation_wrapper_parameter_error);
            else {
                const auto count = embed_sims->factors.get<fixed_factor>(id).values.size();
                if (not count or count > 128 or bounded_count > 128 / count)
                    return make_error(simulation_errc::simulation_wrapper_parameter_error);
                bounded_count *= count;
            }
            ++slot;
        }
        if (required_inputs != singles or bounded_count != nb_sims)
            return make_error(simulation_errc::simulation_wrapper_parameter_error);
        if (not embed_sims->dynamic_capacity) embed_sims->dynamic_capacity = nb_sims;
        if (not embed_sims->dynamic_max_horizon) embed_sims->dynamic_max_horizon = duration;
        if (embed_sims->dynamic_capacity > nb_sims or embed_sims->dynamic_capacity > 128 or
            not std::isfinite(embed_sims->dynamic_max_horizon) or
            embed_sims->dynamic_max_horizon > duration or embed_sims->dynamic_max_horizon <= zero)
            return make_error(simulation_errc::simulation_wrapper_parameter_error);
        if (not embed_sims->input_parameters.resize(factors))
            return make_error(simulation_errc::simulation_wrapper_not_enough_memory);
        state = run_state::initialized;
        return success();
    }
    if (required_inputs and (run != run_type::complete or embed_sims->factors.size() > 10 or
        (required_inputs >> embed_sims->factors.size()) != 0))
        return make_error(simulation_errc::simulation_wrapper_parameter_error);

    if (not embed_sims->embedded_sims.can_alloc(nb_sims) and
        not embed_sims->embedded_sims.grow<2, 1>(nb_sims))
        return make_error(
          simulation_errc::
            simulation_wrapper_too_many_embedded_simulation_error);

    irt_check(embedded_sims_alloc(*embed_sims, nb_sims)
      .and_then(embedded_sims_copy_parameters, *embed_sims)
      .and_then(embedded_sims_init, *embed_sims));
    state = run_state::initialized;
    return success();
}

static status compute_response(const embedded_simulation& embed_sims,
                               vector<message>& values) noexcept;

static bool scenario_valid(const embedded_simulation& r, embedded_simulation::sub_id id) noexcept
{
    return not r.execution.enabled or r.embedded_sims.get<embedded_simulation::execution_result>(id).outcome ==
      embedded_simulation::scenario_outcome::success;
}

static bool has_failed_scenario(const embedded_simulation& r) noexcept
{
    for (const auto id : r.embedded_sims)
        if (not scenario_valid(r, id)) return true;
    return false;
}

static status establish_results(embedded_simulation& r) noexcept
{
    if (not r.execution.enabled) return success();
    using outcome = embedded_simulation::scenario_outcome;
    for (const auto id : r.embedded_sims) {
        auto& result = r.embedded_sims.get<embedded_simulation::execution_result>(id);
        if (result.outcome != outcome::success) continue;
        const auto& obs = r.embedded_sims.get<embedded_simulation::simulation_observation>(id);
        for (const auto selection : r.selections) {
            const auto* values = obs.get(r.selections.get<model_id>(selection));
            // A missing observation record violates the allocated manifest;
            // it is not a safely isolated absence of scientific samples.
            if (not values)
                return make_error(simulation_errc::simulation_wrapper_embedded_simulation_observation_error);
            if (values->values.empty()) {
                if (result.outcome == outcome::success) result.outcome = outcome::unavailable;
            }
            else if (not std::isfinite(values->compute_result(r.selections.get<criteria_type>(selection))))
                result.outcome = outcome::numerical_invalid;
        }
        if (result.outcome != outcome::success and not r.execution.isolate)
            return make_error(simulation_errc::simulation_wrapper_embedded_simulation_observation_error);
    }
    return success();
}

// Raw per-scenario results are captured at the same logical request as the
// legacy optimizer response. Never reconstruct unselected rows in the runner.
static status scenario_response(const embedded_simulation& resource,
                                real campaign,
                                vector<event_emission>& output) noexcept
{
    const auto base = resource.factors.size() + resource.selections.size();
    const auto count = resource.embedded_sims.size();
    if (not output.reserve(count * (base + 4) + 3))
        return make_error(simulation_errc::simulation_wrapper_not_enough_memory);
    sz valid_count = 0, index = 0;
    for (const auto id : resource.embedded_sims) {
        const auto& child = resource.embedded_sims.get<simulation>(id);
        const auto& obs = resource.embedded_sims.get<embedded_simulation::simulation_observation>(id);
        bool valid = scenario_valid(resource, id);
        for (const auto selection : resource.selections) {
            const auto* values = obs.get(resource.selections.get<model_id>(selection));
            valid = valid and values and std::isfinite(values->compute_result(resource.selections.get<criteria_type>(selection)));
        }
        for (const auto factor : resource.factors)
            valid = valid and std::isfinite(child.parameters[resource.factors.get<model_id>(factor)].reals[0]);
        const auto key = real(index++);
        output.emplace_back(event_emission{ int(base), message{ valid ? one : zero, key, campaign } });
        if (valid) ++valid_count;
        if (not valid and not resource.execution.enabled) continue;
        int port = int(base + 1);
        for (const auto factor : resource.factors)
            output.emplace_back(event_emission{ port++, message{ child.parameters[resource.factors.get<model_id>(factor)].reals[0], key, campaign } });
        const auto& progress = resource.embedded_sims.get<embedded_simulation::execution_result>(id);
        for (const auto selection : resource.selections) {
            const auto* data = obs.get(resource.selections.get<model_id>(selection));
            const auto value = data ? data->compute_result(resource.selections.get<criteria_type>(selection)) : std::numeric_limits<real>::quiet_NaN();
            if (std::isfinite(value) and (valid or (resource.execution.enabled and
                (progress.outcome == embedded_simulation::scenario_outcome::numerical_invalid or
                 progress.outcome == embedded_simulation::scenario_outcome::unavailable))))
                output.emplace_back(event_emission{ port, message{ value, key, campaign } });
            ++port;
        }
        if (resource.execution.enabled) {
            const int extra = int(2 * base + 2 + (resource.dynamic_capacity ? 1 : 0));
            output.emplace_back(event_emission{extra, message{real(ordinal(progress.outcome)), key, campaign}});
            output.emplace_back(event_emission{extra + 1, message{real(progress.run_calls), key, campaign}});
            output.emplace_back(event_emission{extra + 2, message{child.limits.end() - child.limits.begin(), key, campaign}});
        }
    }
    if (resource.execution.enabled) {
        const int extra = int(2 * base + 2 + (resource.dynamic_capacity ? 1 : 0));
        output.emplace_back(event_emission{extra + 3, message{real(resource.campaign_run_calls), zero, campaign}});
        output.emplace_back(event_emission{extra + 4, message{real(count), zero, campaign}});
    }
    output.emplace_back(event_emission{ int(2 * base + 1), message{ real(valid_count), real(count), campaign } });
    return success();
}

// Dynamic plans only replace domains, observations, and the bounded child
// horizon. They never compile a graph or pick a preconfigured plan template.
static status transition_dynamic_plan(simulation_wrapper& wrapper,
                                      simulation& parent,
                                      embedded_simulation& resource,
                                      time t) noexcept
{
    auto& frames = resource.dynamic_frames;
    auto& pending = resource.pending_responses;
    const auto factor_count = resource.factors.size();
    const auto ready_port = 2 * (factor_count + resource.selections.size()) + 2;
    const auto safe_integer = [](real value) noexcept {
        return std::isfinite(value) and value >= zero and
          value <= 9007199254740991.0 and std::floor(value) == value;
    };
    const auto valid_campaign = [&](real value) noexcept {
        return safe_integer(value) and value >= one and value > real(wrapper.last_input_campaign);
    };
    const auto frame_for = [&](real campaign) noexcept -> embedded_simulation::dynamic_plan_frame* {
        auto it = std::find_if(frames.begin(), frames.end(),
          [&](const auto& frame) { return frame.campaign == campaign; });
        if (it != frames.end()) return &*it;
        if (frames.size() >= 128 or not frames.reserve(frames.size() + 1)) return nullptr;
        frames.emplace_back(embedded_simulation::dynamic_plan_frame{});
        frames.back().campaign = campaign;
        return &frames.back();
    };
    const auto enqueue = [&](embedded_simulation::response&& response) noexcept -> status {
        if (pending.size() >= 128 or not pending.reserve(pending.size() + 1))
            return make_error(simulation_errc::event_capacity_error);
        auto pos = pending.begin();
        while (pos != pending.end() and pos->due <= response.due) ++pos;
        pending.emplace(pos, std::move(response));
        return success();
    };

    sz slot = 0;
    for (const auto factor : resource.factors) {
        const auto single = resource.factors.get<factor_type>(factor) == factor_type::single;
        for (const auto& msg : get_message(parent, wrapper.x[slot + 2])) {
            if (not valid_campaign(msg[2]) or not safe_integer(msg[1]) or
                msg[1] >= real(resource.dynamic_capacity) or (single and msg[1] != zero) or
                not std::isfinite(msg[0]) or std::abs(msg[0]) > 1e12)
                return make_error(simulation_errc::event_protocol_error);
            auto* frame = frame_for(msg[2]);
            if (not frame) return make_error(simulation_errc::event_capacity_error);
            const auto index = static_cast<unsigned>(msg[1]);
            const auto bit = u64{1} << (index % 64);
            if (frame->sealed or (frame->indices[slot][index / 64] & bit))
                return make_error(simulation_errc::event_protocol_error);
            frame->indices[slot][index / 64] |= bit;
            frame->domains[slot][index] = msg[0];
            ++frame->received[slot];
        }
        ++slot;
    }

    // A bag is unordered: collect every metadata field before interpreting
    // its seal/cancel commands. Duplicate fields are always an error.
    for (const auto& msg : get_message(parent, wrapper.x[factor_count + 2])) {
        if (not valid_campaign(msg[2]) or not safe_integer(msg[1]) or msg[1] >= real(factor_count + 5))
            return make_error(simulation_errc::event_protocol_error);
        const auto field = static_cast<unsigned>(msg[1]);
        auto* frame = frame_for(msg[2]);
        if (not frame) return make_error(simulation_errc::event_capacity_error);
        const auto bit = 1u << field;
        if ((frame->sealed and field != 4) or (frame->fields & bit))
            return make_error(simulation_errc::event_protocol_error);
        frame->fields |= bit;
        if (field <= 1) {
            if (not safe_integer(msg[0]) or msg[0] < one)
                return make_error(simulation_errc::event_protocol_error);
            if (field == 0) frame->plan_id = msg[0]; else frame->version = msg[0];
        } else if (field == 2) {
            const auto begin = resource.sim.limits.begin();
            const auto end = begin + msg[0];
            if (not std::isfinite(msg[0]) or msg[0] <= zero or
                msg[0] > resource.dynamic_max_horizon or not std::isfinite(end) or
                end <= begin or end > resource.sim.limits.end())
                return make_error(simulation_errc::event_protocol_error);
            frame->horizon = msg[0];
        } else if (field == 3 or field == 4) {
            if (msg[0] != zero) return make_error(simulation_errc::event_protocol_error);
        } else {
            const auto index = field - 5;
            if ((wrapper.required_inputs & (1u << index)) or not safe_integer(msg[0]) or
                msg[0] < one or msg[0] > real(resource.dynamic_capacity))
                return make_error(simulation_errc::event_protocol_error);
            frame->cardinalities[index] = static_cast<unsigned>(msg[0]);
        }
    }

    real canceled = zero;
    for (auto& frame : frames) {
        if (not frame.sealed and (frame.fields & (1u << 3)) and (frame.fields & (1u << 4)))
            return make_error(simulation_errc::event_protocol_error);
        if (frame.fields & (1u << 4)) canceled = std::max(canceled, frame.campaign);
    }
    if (canceled > zero) {
        wrapper.last_input_campaign = static_cast<u64>(canceled);
        frames.erase(std::remove_if(frames.begin(), frames.end(),
          [&](const auto& frame) { return frame.campaign <= canceled; }), frames.end());
        pending.erase(std::remove_if(pending.begin(), pending.end(), [&](const auto& response) {
            return response.values.empty() and response.scenarios.size() == 1 and
              response.scenarios.front().port == int(ready_port) and response.scenarios.front().value[2] <= canceled;
        }), pending.end());
    }
    for (auto& frame : frames) {
        if (frame.sealed or not (frame.fields & (1u << 3))) continue;
        unsigned required_fields = 7u | (1u << 3);
        sz count = 1;
        for (sz i = 0; i < factor_count; ++i) {
            const auto single = (wrapper.required_inputs & (1u << i)) != 0;
            const auto cardinality = single ? 1u : frame.cardinalities[i];
            if (not single) required_fields |= 1u << (5 + i);
            if (not cardinality or frame.received[i] != cardinality or
                count > resource.dynamic_capacity / cardinality)
                return make_error(simulation_errc::event_protocol_error);
            for (unsigned index = 0; index < cardinality; ++index)
                if (not (frame.indices[i][index / 64] & (u64{1} << (index % 64))))
                    return make_error(simulation_errc::event_protocol_error);
            count *= cardinality;
        }
        if (frame.fields != required_fields)
            return make_error(simulation_errc::event_protocol_error);
        frame.scenarios = count;
        frame.sealed = true;
        embedded_simulation::response ready{t, {}};
        if (not ready.scenarios.reserve(1)) return make_error(simulation_errc::event_capacity_error);
        ready.scenarios.emplace_back(event_emission{int(ready_port), message{real(count), frame.plan_id, frame.campaign}});
        irt_check(enqueue(std::move(ready)));
    }

    const auto init = get_message(parent, wrapper.x[0]);
    const auto run = get_message(parent, wrapper.x[1]);
    if (init.size() > 1 or run.size() > 1)
        return make_error(simulation_errc::event_protocol_error);
    for (const auto& msg : init)
        if (not valid_campaign(msg[2]) or msg[1] != zero or msg[0] != zero)
            return make_error(simulation_errc::event_protocol_error);
    for (const auto& msg : run)
        if (not valid_campaign(msg[2]) or msg[1] != zero or std::isnan(msg[0]) or msg[0] < zero)
            return make_error(simulation_errc::event_protocol_error);
    if (not init.empty() and not run.empty() and init.front()[2] != run.front()[2])
        return make_error(simulation_errc::event_protocol_error);
    if (not init.empty()) {
        const auto frame = std::find_if(frames.begin(), frames.end(),
          [&](const auto& f) { return f.campaign == init.front()[2]; });
        if (frame == frames.end() or not frame->sealed)
            return make_error(simulation_errc::event_protocol_error);
        // Init cancels execution responses, while staged sealed plans remain
        // valid. Preserve their acknowledgements, including plans sealed in
        // this unordered bag, so every later run retains its validation event.
        pending.erase(std::remove_if(pending.begin(), pending.end(), [&](const auto& response) {
            return not (response.values.empty() and response.scenarios.size() == 1 and
              response.scenarios.front().port == int(ready_port));
        }), pending.end());
    }
    if (not run.empty()) {
        const auto& command = run.front();
        const auto frame = std::find_if(frames.begin(), frames.end(),
          [&](const auto& f) { return f.campaign == command[2]; });
        if (frame == frames.end() or not frame->sealed)
            return make_error(simulation_errc::event_protocol_error);
        const auto delay = std::isinf(command[0]) ? zero : command[0];
        auto due = t + delay;
        if (delay > zero and due == t) due = std::nextafter(t, time_domain<time>::infinity);
        if (not std::isfinite(due)) return make_error(simulation_errc::event_protocol_error);
        irt_check(embedded_sims_alloc(resource, frame->scenarios));
        irt_check(embedded_sims_copy_parameters_from_plan(resource, &*frame));
        for (const auto child : resource.embedded_sims)
            resource.embedded_sims.get<simulation>(child).limits.set_bound(
              resource.sim.limits.begin(), resource.sim.limits.begin() + frame->horizon);
        irt_check(embedded_sims_init(resource));
        wrapper.state = simulation_wrapper::run_state::running;
        irt_check(run_complete(resource));
        wrapper.state = simulation_wrapper::run_state::finish;
        embedded_simulation::response result{due, {}};
        irt_check(establish_results(resource));
        irt_check(scenario_response(resource, command[2], result.scenarios));
        if (not resource.execution.collect_only) irt_check(compute_response(resource, result.values));
        irt_check(enqueue(std::move(result)));
        wrapper.last_input_campaign = static_cast<u64>(command[2]);
        frames.erase(std::remove_if(frames.begin(), frames.end(),
          [&](const auto& f) { return f.campaign <= command[2]; }), frames.end());
    }
    wrapper.sigma = pending.empty() ? time_domain<time>::infinity : pending.front().due - t;
    return success();
}

status simulation_wrapper::transition(simulation& sim,
                                      time t,
                                      [[maybe_unused]] time e,
                                      [[maybe_unused]] time r) noexcept
{
    auto* embed_sims = sim.sims.try_to_get(sim_id);
    auto& pending_responses = embed_sims->pending_responses;

    // lambda precedes transition, including a confluent external bag.
    if (response_emitted) {
        pending_responses.erase(pending_responses.begin());
        response_emitted = false;
    }

    if (dynamic_plan) return transition_dynamic_plan(*this, sim, *embed_sims, t);

    debug::ensure(x.size() == embed_sims->input_parameters.size() + 2);

    const auto init_msg = get_message(sim, x[ordinal(input_init)]);
    const auto run_msg  = get_message(sim, x[ordinal(input_run)]);

    // Legacy documents keep last-value scalar inputs. Addressed transactions
    // never borrow a missing field from another observation cycle.
    const auto valid_frame = [this](const message& m) noexcept {
        return m[1] == zero and std::isfinite(m[2]) and m[2] >= one and
          m[2] <= 9007199254740991.0 and std::floor(m[2]) == m[2] and
          m[2] > real(last_input_campaign);
    };
    auto& frames = embed_sims->input_frames;
    constexpr unsigned prepared_frame = 1u << 31;

    for (sz i = 0; i < embed_sims->input_parameters.size(); ++i) {
        const auto i_param_msg = get_message(sim, x[i + 2]);

        if (not i_param_msg.empty()) {
            if (required_inputs) {
                for (const auto& msg : i_param_msg) {
                    if (not valid_frame(msg) or not std::isfinite(msg[0]))
                        return make_error(simulation_errc::event_protocol_error);
                    auto pos = std::find_if(frames.begin(), frames.end(),
                      [&](const auto& f) { return f.campaign == msg[2]; });
                    if (pos == frames.end()) {
                        if (frames.size() >= 128 or not frames.reserve(frames.size() + 1))
                            return make_error(simulation_errc::event_capacity_error);
                        frames.emplace_back(embedded_simulation::input_frame{});
                        pos = frames.end() - 1;
                        pos->campaign = msg[2];
                    }
                    // A DEVS bag has no order: conflicting duplicates are an
                    // error, including duplicates arriving in later bags.
                    if ((pos->mask & (1u << i)) and pos->values[i] != msg[0])
                        return make_error(simulation_errc::event_protocol_error);
                    if (not (pos->mask & (1u << i))) pos->mask &= ~prepared_frame;
                    pos->values[i] = msg[0]; pos->mask |= 1u << i;
                }
            } else {
                embed_sims->input_parameters[i].value = i_param_msg.back()[0];
                state = run_state::input_changed;
            }
        }
    }

    real requested_campaign = 0;
    if (required_inputs and (not init_msg.empty() or not run_msg.empty())) {
        if (init_msg.size() > 1 or run_msg.size() > 1)
            return make_error(simulation_errc::event_protocol_error);
        const auto& command = not run_msg.empty() ? run_msg.front() : init_msg.front();
        if (not valid_frame(command) or (not init_msg.empty() and
            (not valid_frame(init_msg.front()) or init_msg.front()[2] != command[2])))
            return make_error(simulation_errc::event_protocol_error);
        requested_campaign = command[2];
        const auto frame = std::find_if(frames.begin(), frames.end(),
          [&](const auto& f) { return f.campaign == requested_campaign; });
        if (frame == frames.end() or (frame->mask & required_inputs) != required_inputs)
            return make_error(simulation_errc::event_protocol_error);
        for (sz i = 0; i < embed_sims->input_parameters.size(); ++i) {
            auto& value = embed_sims->input_parameters[i].value;
            if (frame->mask & (1u << i)) value = frame->values[i];
            else value.reset();
        }
        if (not (frame->mask & prepared_frame)) state = run_state::input_changed;
    }

    if (not init_msg.empty()) {
        const auto ret = embedded_sims_copy_parameters(*embed_sims)
                           .and_then(embedded_sims_init, *embed_sims);

        if (ret.has_error())
            return ret.error();

        state = run_state::initialized;
        pending_responses.clear();
        if (required_inputs) {
            // Only this frame describes the currently initialized children.
            // A following run must not draw random factors a second time.
            for (auto& frame : frames) {
                frame.mask &= ~prepared_frame;
                if (frame.campaign == requested_campaign) frame.mask |= prepared_frame;
            }
        }
    }

    if (not run_msg.empty()) {
        if (execution_status and pending_responses.size() >= 128)
            return make_error(simulation_errc::event_capacity_error);
        for (const auto& msg : run_msg)
            if (std::isnan(msg[0]) or msg[0] < zero)
                return make_error(
                  simulation_errc::simulation_wrapper_parameter_error);

        const auto time_param = get_min_message(run_msg);
        const auto delay = time_domain<time>::is_infinity(time_param)
                             ? zero : time_param;
        auto due = t + delay;
        // Preserve the engine's rule for a positive delay smaller than the
        // representable spacing at t. This is floating-point rounding, not
        // an epsilon introduced to escape zero-time transitions.
        if (delay > zero and due == t)
            due = std::nextafter(t, time_domain<time>::infinity);
        if (not std::isfinite(due))
            return make_error(
              simulation_errc::simulation_wrapper_parameter_error);

        switch (run) {
        case run_type::complete:
            if (state == run_state::input_changed or
                (execution_status and state == run_state::finish and has_failed_scenario(*embed_sims))) {
                const auto ret = embedded_sims_copy_parameters(*embed_sims)
                                   .and_then(embedded_sims_init, *embed_sims);

                if (ret.has_error())
                    return ret.error();

                state = run_state::initialized;
            } else if (execution_status and state == run_state::finish) {
                // Preserve historical complete-mode reuse after an entirely
                // valid run. This request makes no new child calls. Failed
                // campaigns above always prepare fresh children instead.
                embed_sims->campaign_run_calls = 0;
                for (const auto id : embed_sims->embedded_sims)
                    embed_sims->embedded_sims.get<embedded_simulation::execution_result>(id).run_calls = 0;
            }

            if (state == run_state::initialized or state == run_state::finish) {
                state   = run_state::running;
                irt_check(run_complete(*embed_sims));
                state   = run_state::finish;
            }
            break;

        case run_type::bag:
            irt_check(run_bag(*embed_sims));
            break;

        case run_type::time:
            irt_check(run_time(*embed_sims));
            break;

        case run_type::until:
            irt_check(run_until(*embed_sims, time_param));
            break;

        case run_type::during:
            irt_check(run_during(*embed_sims, time_param));
            break;
        }

        embedded_simulation::response result{ due, {} };
        irt_check(establish_results(*embed_sims));
        if (scenario_results) {
            if (campaign >= 9007199254740991ULL)
                return make_error(simulation_errc::simulation_wrapper_parameter_error);
            irt_check(scenario_response(*embed_sims, required_inputs ? requested_campaign : real(++campaign), result.scenarios));
        }
        if (not embed_sims->execution.collect_only) irt_check(compute_response(*embed_sims, result.values));
        if (not pending_responses.reserve(pending_responses.size() + 1))
            return make_error(
              simulation_errc::simulation_wrapper_not_enough_memory);
        auto pos = pending_responses.begin();
        while (pos != pending_responses.end() and pos->due <= due)
            ++pos;
        pending_responses.emplace(pos, std::move(result));
        if (required_inputs) {
            last_input_campaign = static_cast<u64>(requested_campaign);
            for (auto& frame : frames) frame.mask &= ~prepared_frame;
            frames.erase(std::remove_if(frames.begin(), frames.end(),
              [&](const auto& f) { return f.campaign <= requested_campaign; }), frames.end());
        }
    }

    sigma = pending_responses.empty() ? time_domain<time>::infinity
                                      : pending_responses.front().due - t;
    return success();
}

static auto compute_extremum(const auto& embedded_sims,
                             const auto mdl_id,
                             const bool minimize,
                             const bool last) noexcept
  -> std::pair<embedded_simulation::sub_id, size_t>
{
    auto        best_id = undefined<embedded_simulation::sub_id>();
    auto        index   = size_t(0);
    auto        value   = minimize ? std::numeric_limits<real>::infinity()
                                  : -std::numeric_limits<real>::infinity();
    const auto& sim_obs = embedded_sims.template get<
      embedded_simulation::simulation_observation>();

    for (const auto id : embedded_sims) {
        if (const auto* ptr = sim_obs[id].get(mdl_id);
            ptr and not ptr->values.empty()) {
            const auto begin = last ? ptr->values.size() - 1 : 0;
            for (auto i = begin; i < ptr->values.size(); ++i) {
                const auto candidate = ptr->values[i].value;
                if (std::isfinite(candidate) and
                    (minimize ? candidate < value : candidate > value)) {
                    value = candidate;
                    best_id = id;
                    index = i;
                }
            }
        }
    }

    return std::make_pair(best_id, index);
}

static auto compute_min_last(const auto& embedded_sims,
                             const auto mdl_id) noexcept
  -> std::pair<embedded_simulation::sub_id, size_t>
{
    return compute_extremum(embedded_sims, mdl_id, true, true);
}

static auto compute_max_last(const auto& embedded_sims,
                             const auto  mdl_id) noexcept
  -> std::pair<embedded_simulation::sub_id, size_t>
{
    return compute_extremum(embedded_sims, mdl_id, false, true);
}

static auto compute_min(const auto& embedded_sims, const auto mdl_id) noexcept
  -> std::pair<embedded_simulation::sub_id, size_t>
{
    return compute_extremum(embedded_sims, mdl_id, true, false);
}

static auto compute_max(const auto& embedded_sims, const auto mdl_id) noexcept
  -> std::pair<embedded_simulation::sub_id, size_t>
{
    return compute_extremum(embedded_sims, mdl_id, false, false);
}

/* * * * *
 *
 * compute result of a embedded_model_observation
 *
 * * * * */

real embedded_simulation::embedded_model_observation::compute_result(
  const criteria_type type) const noexcept
{
    // A criterion on unavailable data is not a finite objective. Never read
    // back() on an empty history, nor let NaN be silently ignored by min/max.
    if (values.empty())
        return std::numeric_limits<real>::quiet_NaN();
    for (const auto& sample : values)
        if (not std::isfinite(sample.t) or not std::isfinite(sample.value))
            return std::numeric_limits<real>::quiet_NaN();

    auto ret = real{};

    switch (type) {
    case criteria_type::min_last:
        ret = values.back().value;
        break;

    case criteria_type::max_last:
        ret = values.back().value;
        break;

    case criteria_type::min:
        ret = std::numeric_limits<real>::max();

        for (auto i = 0, e = length(values); i != e; ++i)
            ret = std::min(ret, values[i].value);

        break;

    case criteria_type::max:
        ret = std::numeric_limits<real>::lowest();

        for (auto i = 0, e = length(values); i != e; ++i)
            ret = std::max(ret, values[i].value);

        break;
    }

    return ret;
}

struct pos_in_objective_function {

    pos_in_objective_function(u32 objective_fn_size_) noexcept
      : objective_fn_size{ objective_fn_size_ }
    {}

    u32 operator()(const embedded_simulation::sub_id sub_id,
                   const selection_id                obj_fn_id) const noexcept
    {
        return static_cast<u32>(get_index(sub_id) * objective_fn_size +
                                get_index(obj_fn_id));
    }

    const u32 objective_fn_size;
};

static auto collect_response(const embedded_simulation& embed_sims,
                 const embedded_simulation::sub_id best_sub_id,
                 const std::span<const real>       objective_fn,
                 vector<message>& values) noexcept -> status
{
    if (not embed_sims.embedded_sims.exists(best_sub_id))
        return success();

    const pos_in_objective_function pos(embed_sims.selections.size());
    if (not values.reserve(embed_sims.selections.size() +
                           embed_sims.factors.size()))
        return make_error(
          simulation_errc::simulation_wrapper_not_enough_memory);

    // Send the observation values of the best embedded simulation

    for (const auto obj_fn_id : embed_sims.selections) {
        const auto idx = pos(best_sub_id, obj_fn_id);
        const auto val = objective_fn[idx];

        values.push_back(message{ val, zero, zero });
    }

    // Send the parameters values of the best embedded simulation to the

    const auto& sub_sims = embed_sims.embedded_sims.get<simulation>();
    for (const auto factor_id : embed_sims.factors) {
        const auto id  = embed_sims.factors.get<model_id>(factor_id);
        const auto idx = get_index(id);
        const auto msg = message{
            sub_sims[best_sub_id].parameters[idx].reals[0],
            sub_sims[best_sub_id].parameters[idx].reals[1],
            sub_sims[best_sub_id].parameters[idx].reals[2]
        };

        values.push_back(msg);
    }

    return success();
}

// A vector of reals models the objectives functions. The size equals the
// multiplication of the numbers of embedded simulations and objective
// function element.
//
// The form is:
// -------------------------------------------------------------------------
// | obj_1 | obj_2 | obj_3 | obj_1 | obj_2 | obj_3 | obj_1 | obj_2 | obj_3 |
// -------------------------------------------------------------------------
// | sub_simulation_1      | sub_simulation_2      | sub_simulation_3      |
// -------------------------------------------------------------------------
static auto compute_embedded_simulation_results(
  const embedded_simulation& embed_sims) noexcept -> expected<vector<real>>
{
    const auto objective_fn_size = embed_sims.selections.size();
    const auto simulation_size   = embed_sims.embedded_sims.size();
    const auto size              = objective_fn_size * simulation_size;
    auto       objective_fn      = vector<real>(size);

    if (std::cmp_not_equal(objective_fn.size(), size))
        return make_error(
          simulation_errc::simulation_wrapper_not_enough_memory);

    const pos_in_objective_function pos(objective_fn_size);

    // For each embedded simulation, for each objective function element,
    // computes result of the observation trajectory according to tge
    // criteria_type and fill the objective funiton.

    auto& sim_obs = embed_sims.embedded_sims
                      .get<embedded_simulation::simulation_observation>();

    for (const auto sub_id : embed_sims.embedded_sims) {
        if (not scenario_valid(embed_sims, sub_id)) continue;
        for (const auto obj_fn_id : embed_sims.selections) {
            const auto type = embed_sims.selections.get<criteria_type>(
              obj_fn_id);
            const auto mdl_id = embed_sims.selections.get<model_id>(obj_fn_id);

            if (const auto* ptr = sim_obs[sub_id].get(mdl_id)) {
                const auto val = ptr->compute_result(type);
                const auto idx = pos(sub_id, obj_fn_id);

                if (not std::isfinite(val))
                    return make_error(
                      simulation_errc::simulation_wrapper_embedded_simulation_observation_error);

                objective_fn[idx] = val;
            } else
                return make_error(
                  simulation_errc::simulation_wrapper_embedded_simulation_observation_error);
        }
    }

    dlogln(0, "full observation (selections in {} objective",
           embed_sims.selections.size());

    for (const auto obj_fn_id : embed_sims.selections) {
        dlogln(2, "- model {}",
               embed_sims.selections.get<name_str>(obj_fn_id).sv());

        const auto mdl_id = embed_sims.selections.get<model_id>(obj_fn_id);

        for (const auto sub_id : embed_sims.embedded_sims) {
            if (not scenario_valid(embed_sims, sub_id)) continue;
            dlogln(4, "- sub-id {}", get_index(sub_id));
            dlogln(4, "|{:^12}|{:^12}|", "time", "value");
            dlogln(4, "|{:-^12}|{:-^12}|", "", "");
            if (const auto* ptr = sim_obs[sub_id].get(mdl_id)) {
                for (const auto& v : ptr->values)
                    dlogln(4, "|{:^12.5}|{:^12.5}|", v.t, v.value);
            }
            dlogln(1, "\n");
        }
    }

    dlogln(0, "compute embedeed selection");
    dlog(4, "|{:^12}|", "sub-id");
    for (const auto obj_fn_id : embed_sims.selections) {
        dlog(0, "{:^12}|", embed_sims.selections.get<name_str>(obj_fn_id).sv());
    }
    dlogln(0, "");
    dlog(4, "|{:-^12}|", "");
    for (const auto obj_fn_id : embed_sims.selections) {
        (void)obj_fn_id;
        dlog(0, "{:-^12}|", "");
    }

    dlogln(0, "");
    for (const auto sub_id : embed_sims.embedded_sims) {
        if (not scenario_valid(embed_sims, sub_id)) continue;
        dlog(4, "|{:^12}|", get_index(sub_id));

        for (const auto obj_fn_id : embed_sims.selections) {
            const auto idx = pos(sub_id, obj_fn_id);

            dlog(0, "{:^12.5}|", objective_fn[idx]);
        }

        dlogln(0, "");
    }

    return objective_fn;
}

/* * * * * *
 *
 * weighted_sum
 *
 * * * * * */

static auto compute_weighted_sum_objective(
  const embedded_simulation& embed_sims,
  std::span<real>            objective_fn) noexcept
  -> expected<embedded_simulation::sub_id>
{
    const pos_in_objective_function pos(embed_sims.selections.size());

    debug::ensure(embed_sims.objective.weighted_sum_params.types.size() ==
                  embed_sims.selections.size());
    debug::ensure(embed_sims.objective.weighted_sum_params.weights.size() ==
                  embed_sims.selections.size());

    sz valid_count = 0;
    for (const auto id : embed_sims.embedded_sims) if (scenario_valid(embed_sims, id)) ++valid_count;
    if (not valid_count) return undefined<embedded_simulation::sub_id>();

    // If min-max linearization

    if (embed_sims.objective.weighted_sum_params.norm == norm_type::min_max) {
        for (const auto obj_fn_id : embed_sims.selections) {
            const auto is_max = embed_sims.objective.weighted_sum_params
                                  .types[get_index(obj_fn_id)] ==
                                optimization_type::maximize;

            auto min_val = std::numeric_limits<real>::max();
            auto max_val = std::numeric_limits<real>::lowest();

            for (const auto sub_id : embed_sims.embedded_sims) {
                if (not scenario_valid(embed_sims, sub_id)) continue;
                const auto idx = pos(sub_id, obj_fn_id);
                const auto val = objective_fn[idx];

                min_val = std::min(min_val, val);
                max_val = std::max(max_val, val);
            }

            const auto diff = max_val - min_val;
            const auto div  = diff < 1e-10 ? 1e-10 : diff;

            if (is_max) {
                for (const auto sub_id : embed_sims.embedded_sims) {
                    if (not scenario_valid(embed_sims, sub_id)) continue;
                    const auto idx    = pos(sub_id, obj_fn_id);
                    objective_fn[idx] = (objective_fn[idx] - min_val) / div;
                }
            } else {
                for (const auto sub_id : embed_sims.embedded_sims) {
                    if (not scenario_valid(embed_sims, sub_id)) continue;
                    const auto idx    = pos(sub_id, obj_fn_id);
                    objective_fn[idx] = (max_val - objective_fn[idx]) / div;
                }
            }
        }
    } else {
        for (const auto obj_fn_id : embed_sims.selections) {
            const auto is_max = embed_sims.objective.weighted_sum_params
                                  .types[get_index(obj_fn_id)] ==
                                optimization_type::maximize;

            auto sum = 0.0;
            for (const auto sub_id : embed_sims.embedded_sims)
                if (scenario_valid(embed_sims, sub_id)) sum += objective_fn[pos(sub_id, obj_fn_id)];
            const auto mean = sum / valid_count;
            auto squared_deviations = 0.0;
            for (const auto sub_id : embed_sims.embedded_sims) {
                if (not scenario_valid(embed_sims, sub_id)) continue;
                const auto delta = objective_fn[pos(sub_id, obj_fn_id)] - mean;
                squared_deviations += delta * delta;
            }
            // Population standard deviation, centered for both directions.
            // The second pass also avoids E[x*x]-E[x]^2 cancellation.
            const auto std_dev = std::sqrt(
              squared_deviations / valid_count);
            const auto div = std_dev < 1e-10 ? 1e-10 : std_dev;
            for (const auto sub_id : embed_sims.embedded_sims) {
                if (not scenario_valid(embed_sims, sub_id)) continue;
                const auto idx = pos(sub_id, obj_fn_id);
                objective_fn[idx] = (is_max ? objective_fn[idx] - mean
                                           : mean - objective_fn[idx]) / div;
            }
        }
    }

    const auto is_max = embed_sims.objective.type ==
                        optimization_type::maximize;

    auto best_sub_id = undefined<embedded_simulation::sub_id>();
    auto best_value  = is_max ? std::numeric_limits<real>::lowest()
                              : std::numeric_limits<real>::max();

    for (const auto sub_id : embed_sims.embedded_sims) {
        if (not scenario_valid(embed_sims, sub_id)) continue;
        auto value = 0.0;
        for (const auto obj_fn_id : embed_sims.selections) {
            const auto w = embed_sims.objective.weighted_sum_params
                             .weights[get_index(obj_fn_id)];

            const auto idx = pos(sub_id, obj_fn_id);
            value += w * objective_fn[idx];
        }

        if (not std::isfinite(value))
            return make_error(
              simulation_errc::simulation_wrapper_embedded_simulation_observation_error);

        if (is_max) {
            if (value > best_value) {
                best_value  = value;
                best_sub_id = sub_id;
            }
        } else {
            if (value < best_value) {
                best_value  = value;
                best_sub_id = sub_id;
            }
        }
    }

    return best_sub_id;
}

static auto do_weighted_sum_optimization(const embedded_simulation& embed_sims,
                                         vector<message>& values) noexcept -> status
{
    debug::ensure(embed_sims.objective.method ==
                  optimization_method::weighted_sum);

    auto objective_fn_ret = compute_embedded_simulation_results(embed_sims);

    if (objective_fn_ret.has_error())
        return objective_fn_ret.error();

    const auto best_sub_id = compute_weighted_sum_objective(embed_sims,
                                                            *objective_fn_ret);

    if (best_sub_id.has_error())
        return best_sub_id.error();

    return embed_sims.embedded_sims.exists(*best_sub_id)
             ? collect_response(embed_sims, *best_sub_id, *objective_fn_ret, values)
             : success();
}

/* * * * * *
 *
 * compute epsilon constrained optimization
 *
 * * * * * */

static auto filter(const embedded_simulation& embed_sims,
                   const std::span<real>      objective_fn) noexcept
  -> vector<embedded_simulation::sub_id>
{
    const pos_in_objective_function pos(embed_sims.selections.size());
    const auto                      max_size = embed_sims.embedded_sims.size();

    auto ret = vector<embedded_simulation::sub_id>(max_size, reserve_tag);

    auto& sim_obs = embed_sims.embedded_sims
                      .get<embedded_simulation::simulation_observation>();

    for (const auto sub_id : embed_sims.embedded_sims) {
        if (not scenario_valid(embed_sims, sub_id)) continue;
        auto all_obj_valid = true;

        for (const auto obj_fn_id : embed_sims.selections) {
            const auto obj_fn_idx = get_index(obj_fn_id);
            const auto mdl_id = embed_sims.selections.get<model_id>(obj_fn_id);

            if (sim_obs[sub_id].get(mdl_id)) {
                const auto idx = pos(sub_id, obj_fn_id);
                const auto val = objective_fn[idx];

                if (not embed_sims.objective.epsilon_constrained_params.valid(
                      obj_fn_idx, val)) {
                    all_obj_valid = false;
                    break;
                }
            }
        }

        if (all_obj_valid)
            ret.push_back(sub_id);
    }

    return ret;
}

static auto select(
  const embedded_simulation&                   embed_sims,
  const std::span<real>                        objective_fn,
  const std::span<embedded_simulation::sub_id> candidates) noexcept
  -> embedded_simulation::sub_id
{
    const pos_in_objective_function pos(embed_sims.selections.size());
    const auto prim_id = embed_sims.objective.epsilon_constrained_params
                           .primary;

    debug::ensure(embed_sims.selections.exists(prim_id));

    const auto is_max      = embed_sims.objective.type ==
                             optimization_type::maximize;
    auto       best_sub_id = undefined<embedded_simulation::sub_id>();
    auto       best_value  = is_max ? std::numeric_limits<real>::lowest()
                                    : std::numeric_limits<real>::max();

    for (const auto sub_id : candidates) {
        const auto idx = pos(sub_id, prim_id);
        const auto val = objective_fn[idx];

        if (is_max) {
            if (val > best_value) {
                best_value  = val;
                best_sub_id = sub_id;
            }
        } else {
            if (val < best_value) {
                best_value  = val;
                best_sub_id = sub_id;
            }
        }
    }

    return best_sub_id;
}

static auto do_epsilon_constrained_optimization(
  const embedded_simulation& embed_sims,
  vector<message>& values) noexcept -> status
{
    debug::ensure(embed_sims.objective.method ==
                  optimization_method::epsilon_constrained);
    debug::ensure(
      embed_sims.objective.epsilon_constrained_params.epsilons.size() ==
      embed_sims.selections.size());
    debug::ensure(
      embed_sims.objective.epsilon_constrained_params.operations.size() ==
      embed_sims.selections.size());
    debug::ensure(embed_sims.selections.exists(
      embed_sims.objective.epsilon_constrained_params.primary));

    auto objective_fn_ret = compute_embedded_simulation_results(embed_sims);

    if (objective_fn_ret.has_error())
        return objective_fn_ret.error();

    auto filtered    = filter(embed_sims, *objective_fn_ret);
    auto best_sub_id = select(embed_sims, *objective_fn_ret, filtered);

    dlogln(0, "select sub-id {}", get_index(best_sub_id));

    return embed_sims.embedded_sims.exists(best_sub_id)
             ? collect_response(embed_sims, best_sub_id, *objective_fn_ret, values)
             : success();
}

/* * * * * *
 *
 * compute simple optimization for a single @c selection_id
 *
 * * * * * */

static auto do_simple_optimization(const embedded_simulation& embed_sims,
                                   vector<message>& values) noexcept -> status
{
    debug::ensure(embed_sims.objective.method == optimization_method::simple);
    debug::ensure(
      embed_sims.selections.exists(embed_sims.objective.simple_params.primary));

    const pos_in_objective_function pos(embed_sims.selections.size());

    auto objective_fn_ret = compute_embedded_simulation_results(embed_sims);

    if (objective_fn_ret.has_error())
        return objective_fn_ret.error();

    auto&      objective_fn = *objective_fn_ret;
    const auto sel_id       = embed_sims.objective.simple_params.primary;
    const auto is_max       = embed_sims.objective.type ==
                              optimization_type::maximize;
    auto       best_sub_id  = undefined<embedded_simulation::sub_id>();
    auto       best_value   = is_max ? std::numeric_limits<real>::lowest()
                                     : std::numeric_limits<real>::max();

    for (const auto sub_id : embed_sims.embedded_sims) {
        if (not scenario_valid(embed_sims, sub_id)) continue;
        const auto idx = pos(sub_id, sel_id);
        const auto val = objective_fn[idx];

        if (is_max) {
            if (val > best_value) {
                best_value  = val;
                best_sub_id = sub_id;
            }
        } else {
            if (val < best_value) {
                best_value  = val;
                best_sub_id = sub_id;
            }
        }
    }

    dlogln(0, "select sub-id {}", get_index(best_sub_id));

    return embed_sims.embedded_sims.exists(best_sub_id)
             ? collect_response(embed_sims, best_sub_id, objective_fn, values)
             : success();
}

static status compute_response(const embedded_simulation& embed_sims,
                               vector<message>& values) noexcept
{
    switch (embed_sims.objective.method) {
    case optimization_method::epsilon_constrained:
        return do_epsilon_constrained_optimization(embed_sims, values);

    case optimization_method::simple:
        return do_simple_optimization(embed_sims, values);

    case optimization_method::weighted_sum:
        return do_weighted_sum_optimization(embed_sims, values);
    }

    return success();
}

status simulation_wrapper::lambda(simulation& sim) noexcept
{
    auto* embed_sims = sim.sims.try_to_get(sim_id);
    const auto& pending_responses = embed_sims->pending_responses;
    if (pending_responses.empty())
        return success();

    auto& response = embed_sims->pending_responses.front();
    const auto& values = response.values;
    debug::ensure(values.empty() or values.size() == embed_sims->factors.size() + embed_sims->selections.size());
    if (not response.selected_sent) {
        for (sz i = 0; i < values.size(); ++i)
            irt_check(send_message(sim, y[i], values[i][0], values[i][1], values[i][2]));
        response.selected_sent = true;
    }
    // One frame per internal transition, at unchanged parent time. A native
    // output port holds one message, so looping all rows here would lose data.
    if (response.next_scenario < response.scenarios.size()) {
        const auto& frame = response.scenarios[response.next_scenario++];
        irt_check(send_message(sim, y[frame.port], frame.value[0], frame.value[1], frame.value[2]));
    }
    response_emitted = response.next_scenario == response.scenarios.size();
    return success();
}

status simulation_wrapper::finalize(simulation& sim) noexcept
{
    auto* embed_sims = sim.sims.try_to_get(sim_id);

    auto& sims    = embed_sims->embedded_sims.get<simulation>();
    auto& sim_obs = embed_sims->embedded_sims
                      .get<embedded_simulation::simulation_observation>();

    for (const auto id : embed_sims->embedded_sims) {
        const auto idx   = get_index(id);
        auto&      sim   = sims[idx];
        auto&      sim_o = sim_obs[idx];

        if (embed_sims->execution.enabled and not scenario_valid(*embed_sims, id)) continue;

        // Expired children were finalized by their run routine. Do not run
        // source cleanup or nested finalizers twice when the parent closes.
        if (not sim.current_time_expired() and sim.finalize().has_error())
            return make_error(
              simulation_errc::
                simulation_wrapper_embedded_simulation_finalization_error);

        update_observations(sim);
        if (copy_history(sim, sim_o).has_error())
            return make_error(
              simulation_errc::
                simulation_wrapper_embedded_simulation_finalization_error);
    }

    return success();
}

} // namespace irt
