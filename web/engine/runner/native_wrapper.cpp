#include "native_wrapper.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace irt_web {
bool single_type(irt::factor_type t) {
    return t == irt::factor_type::single || t == irt::factor_type::single_add || t == irt::factor_type::single_mult;
}
bool random_type(irt::factor_type t) {
    return t == irt::factor_type::random || t == irt::factor_type::random_add || t == irt::factor_type::random_mult;
}
std::size_t factor_cardinality(const factor_spec& f) {
    return random_type(f.type) ? f.random.count : f.values.size();
}
void validate_random_factor(const irt::random_factor& f) {
    require(f.count > 0, "Random count must be positive");
    const auto a=f.reals[0], b=f.reals[1];
    require(std::isfinite(a) && std::isfinite(b), "Random parameters must be finite");
    bool valid=false;
    using D=irt::distribution_type;
    switch(f.dist) {
    case D::uniform_int: valid=f.ints[0]<=f.ints[1]; break;
    case D::uniform_real: valid=a<=b; break;
    case D::bernouilli: valid=a>=0 && a<=1; break;
    case D::binomial: valid=f.ints[0]>=0 && a>=0 && a<=1; break;
    case D::negative_binomial: valid=f.ints[0]>0 && a>0 && a<=1; break;
    case D::geometric: valid=a>0 && a<1; break;
    case D::poisson: case D::exponential: case D::chi_squared: case D::student_t: valid=a>0; break;
    case D::gamma: case D::weibull: case D::fisher_f: valid=a>0 && b>0; break;
    case D::exterme_value: case D::normal: case D::lognormal: case D::cauchy: valid=b>0; break;
    default: break;
    }
    require(valid, "Invalid native distribution or parameter domain");
}
namespace {
const native_target& resolve(const irt::project& pj, const target_table& targets,
                              const std::string& path)
{
    const auto it = targets.find(path);
    require(it != targets.end(), "Unknown prospective target: " + path);
    const auto& target = it->second;
    require(pj.tree_nodes.exists(target.tree) && pj.sim.models.exists(target.model),
            "Target does not belong to the prospective project");
    const auto& tree = *pj.tree_nodes.try_to_get(target.tree);
    require(std::any_of(tree.children.begin(), tree.children.end(), [&](const auto& node) {
        return node.is_model() && node.mdl == target.model;
    }), "Target tree/model mismatch");
    return target;
}

template<class Factors, class Selections>
void configure(Factors& factors, Selections& selections,
                irt::objective_function& objective, const irt::project& pj,
                const target_table& targets, const experiment_spec& spec)
{
    // Fresh containers guarantee dense slots even if copy_to omitted entries.
    factors = Factors{};
    selections = Selections{};
    require(factors.reserve(static_cast<int>(spec.factors.size())) &&
            selections.reserve(static_cast<int>(spec.selections.size())),
            "Factor/selection allocation failed");
    for (const auto& f : spec.factors) {
        const auto id = factors.alloc_id();
        factors.template get<irt::model_id>(id) = resolve(pj, targets, f.target).model;
        factors.template get<irt::name_str>(id) = f.id;
        factors.template get<irt::factor_type>(id) = f.type;
        if (single_type(f.type))
            factors.template get<irt::single_factor>(id).value = f.values.front();
        else if (random_type(f.type)) factors.template get<irt::random_factor>(id) = f.random;
        else factors.template get<irt::fixed_factor>(id).values.assign(f.values.begin(), f.values.end());
        if constexpr (std::is_same_v<Factors, irt::simulation_component::factor_t>) {
            factors.template get<irt::tree_node_id>(id) = targets.at(f.target).tree;
            auto& path = factors.template get<irt::unique_id_path>(id);
            std::size_t begin = 0;
            do {
                const auto end = f.target.find('/', begin);
                path.push_back(std::string_view(f.target).substr(begin, end == std::string::npos ? end : end - begin));
                if (end == std::string::npos) break;
                begin = end + 1;
            } while (true);
        }
    }
    objective.clear();
    objective.method = spec.method;
    objective.type = spec.direction;
    std::size_t slot = 0;
    for (const auto& s : spec.selections) {
        const auto id = selections.alloc_id();
        require(irt::get_index(id) == slot++, "Selections must be dense");
        selections.template get<irt::model_id>(id) = resolve(pj, targets, s.target).model;
        selections.template get<irt::name_str>(id) = s.id;
        selections.template get<irt::criteria_type>(id) = s.criterion;
        if (s.id == spec.primary) {
            objective.simple_params.primary = id;
            objective.epsilon_constrained_params.primary = id;
        }
        if constexpr (std::is_same_v<Selections, irt::simulation_component::selection_t>) {
            selections.template get<irt::tree_node_id>(id) = targets.at(s.target).tree;
            auto& path = selections.template get<irt::unique_id_path>(id);
            std::size_t begin = 0;
            do {
                const auto end = s.target.find('/', begin);
                path.push_back(std::string_view(s.target).substr(begin, end == std::string::npos ? end : end - begin));
                if (end == std::string::npos) break;
                begin = end + 1;
            } while (true);
        }
    }
    if (spec.method != irt::optimization_method::weighted_sum)
        require(selections.exists(objective.simple_params.primary), "Invalid primary selection");
    // irt::vector::assign dereferences first even for an empty range. clear()
    // already emptied inactive parameters; only pass validated nonempty arrays.
    if(spec.method == irt::optimization_method::weighted_sum) {
        objective.weighted_sum_params.weights.assign(spec.weights.begin(), spec.weights.end());
        objective.weighted_sum_params.types.assign(spec.types.begin(), spec.types.end());
        objective.weighted_sum_params.norm = spec.norm;
    } else if(spec.method == irt::optimization_method::epsilon_constrained) {
        objective.epsilon_constrained_params.epsilons.assign(spec.epsilons.begin(), spec.epsilons.end());
        objective.epsilon_constrained_params.operations.assign(spec.operations.begin(), spec.operations.end());
    }
}
} // namespace

std::size_t validate_experiment(const irt::project& pj, const target_table& targets,
                                const experiment_spec& spec)
{
    const auto f = spec.factors.size(), s = spec.selections.size();
    require(f >= 1 && f <= 10 && s >= 1 && f + s >= 3 && f + s <= 12,
            "Native wrapper dimensions require 1<=F<=10, S>=1, 3<=F+S<=12");
    require(!spec.required_inputs || (spec.mode == irt::simulation_wrapper::run_type::complete &&
        (spec.required_inputs >> f) == 0), "Addressed factor inputs require complete mode and valid slots");
    require(spec.method == irt::optimization_method::simple ||
            spec.method == irt::optimization_method::weighted_sum ||
            spec.method == irt::optimization_method::epsilon_constrained, "Invalid optimization method");
    if (spec.method == irt::optimization_method::weighted_sum) {
        require(spec.weights.size() == s && spec.types.size() == s, "Weighted-sum arrays must match selections");
        require(spec.norm == irt::norm_type::min_max || spec.norm == irt::norm_type::z_score, "Invalid norm");
        for (double v : spec.weights) require(std::isfinite(v), "Non-finite weight");
        for (auto t : spec.types) require(t == irt::optimization_type::maximize || t == irt::optimization_type::minimize, "Invalid criterion direction");
    }
    if (spec.method == irt::optimization_method::epsilon_constrained) {
        require(spec.epsilons.size() == s && spec.operations.size() == s, "Epsilon arrays must match all selections, including primary");
        for (double v : spec.epsilons) require(std::isfinite(v), "Non-finite epsilon");
        for (auto op : spec.operations) require(op == irt::operation_type::equal || op == irt::operation_type::not_equal ||
            op == irt::operation_type::greater_equal || op == irt::operation_type::less_equal, "Invalid constraint operation");
    }
    using R=irt::simulation_wrapper::run_type;
    require(spec.mode == R::complete || spec.mode == R::bag || spec.mode == R::time ||
        spec.mode == R::until || spec.mode == R::during, "Invalid execution mode");
    require(spec.direction == irt::optimization_type::maximize ||
            spec.direction == irt::optimization_type::minimize, "Invalid optimization direction");
    require(std::isfinite(pj.sim.limits.begin()) && std::isfinite(pj.sim.limits.end()) &&
            pj.sim.limits.end() > pj.sim.limits.begin(), "Invalid prospective horizon");
    std::set<std::string> names;
    std::set<irt::model_id> models;
    std::size_t count = 1;
    const auto cap = std::min(spec.max_scenarios,
                             static_cast<std::size_t>(std::numeric_limits<int>::max()));
    for (const auto& factor : spec.factors) {
        require(!factor.id.empty() && factor.id.size() < 32 && names.insert(factor.id).second,
                "Invalid or duplicate factor id");
        const auto target = resolve(pj, targets, factor.target).model;
        require(models.insert(target).second, "Multiple factors target the same reals[0]");
        require(factor.real_slot == 0, "Factors can only write reals[0]");
        const auto type = pj.sim.models.get(target).type;
        require(type == irt::dynamics_type::constant || type == irt::dynamics_type::qss1_integrator ||
                type == irt::dynamics_type::qss2_integrator || type == irt::dynamics_type::qss3_integrator,
                "Unsupported factor parameter target");
        require(single_type(factor.type) || random_type(factor.type) || factor.type == irt::factor_type::fixed ||
            factor.type == irt::factor_type::fixed_add || factor.type == irt::factor_type::fixed_mult, "Invalid factor type");
        if (random_type(factor.type)) validate_random_factor(factor.random);
        else {
            require(!factor.values.empty() && (!single_type(factor.type) || factor.values.size() == 1), "Invalid factor cardinality");
            for (double value : factor.values) require(std::isfinite(value), "Non-finite factor value");
        }
        const auto n=factor_cardinality(factor);
        require(count <= cap / n, "Scenario cardinality exceeds budget or native capacity");
        count *= n;
    }
    names.clear();
    for (const auto& selection : spec.selections) {
        require(!selection.id.empty() && selection.id.size() < 32 && names.insert(selection.id).second,
                "Invalid or duplicate selection id");
        const auto model = resolve(pj, targets, selection.target).model;
        const bool observable = irt::dispatch(pj.sim.models.get(model), []<class T>(const T&) {
            return irt::has_observation_function<T>;
        });
        require(observable, "Selection target has no native observation function");
        require(selection.criterion == irt::criteria_type::min || selection.criterion == irt::criteria_type::max ||
                selection.criterion == irt::criteria_type::min_last || selection.criterion == irt::criteria_type::max_last,
                "Invalid native criterion");
    }
    require(spec.method == irt::optimization_method::weighted_sum || names.contains(spec.primary), "Unknown primary selection");
    // Nested wrappers need a separate depth/recursive resource audit.
    require(pj.sim.sims.empty(), "Nested wrapper prototypes are outside Test 7B");
    return count;
}

descriptor make_descriptor(irt::component_access& ids, irt::project&& pj,
                            target_table targets, experiment_spec spec)
{
    const auto count = validate_experiment(pj, targets, spec);
    require(ids.can_alloc_sim_component(1), "Descriptor capacity exceeded");
    const auto component = ids.alloc_sim_component();
    const auto simulation = ids.components[component].id.sim_id;
    auto& native = ids.sim_components.get(simulation);
    checked(native.assign(std::move(pj)), "simulation_component::assign");
    configure(native.factors, native.selections, native.objective, native.pj, targets, spec);
    return {component, simulation, std::move(targets), std::move(spec), count};
}

irt::child_id add_wrapper(irt::generic_component& gen, std::string_view name,
                          const descriptor& desc)
{
    const auto id = add_child(gen, irt::dynamics_type::simulation_wrapper, name);
    gen.children_parameters[id].integers[irt::simulation_wrapper_tag::id] = irt::ordinal(desc.component);
    gen.children_parameters[id].integers[irt::simulation_wrapper_tag::run] = irt::ordinal(desc.spec.mode);
    gen.children_parameters[id].reals[0] = desc.spec.scenario_results ? 1 : 0;
    gen.children_parameters[id].reals[1] = desc.spec.required_inputs;
    return id;
}

copy_audit audit_copy(const irt::embedded_simulation& resource, const descriptor& desc)
{
    copy_audit ret{resource.factors.size(), resource.selections.size(), false};
    if (ret.factors != desc.spec.factors.size() || ret.selections != desc.spec.selections.size()) return ret;
    std::size_t i = 0;
    for (const auto id : resource.factors) {
        const auto& f = desc.spec.factors[i++];
        const auto target = resource.factors.get<irt::model_id>(id);
        if (target != desc.targets.at(f.target).model || !resource.sim.models.exists(target) ||
            resource.factors.get<irt::name_str>(id).sv() != f.id ||
            resource.factors.get<irt::factor_type>(id) != f.type) return ret;
        if (single_type(f.type)) {
            if (resource.factors.get<irt::single_factor>(id).value != f.values.front()) return ret;
        } else if (random_type(f.type)) {
            const auto& r=resource.factors.get<irt::random_factor>(id);
            if(r.count!=f.random.count || r.dist!=f.random.dist || r.reals!=f.random.reals || r.ints!=f.random.ints) return ret;
        } else {
            const auto& values = resource.factors.get<irt::fixed_factor>(id).values;
            if (values.size() != f.values.size() || !std::equal(values.begin(), values.end(), f.values.begin())) return ret;
        }
    }
    i = 0;
    for (const auto id : resource.selections) {
        const auto& s = desc.spec.selections[i++];
        if (irt::get_index(id) != i - 1 || resource.selections.get<irt::model_id>(id) != desc.targets.at(s.target).model ||
            resource.selections.get<irt::criteria_type>(id) != s.criterion ||
            resource.selections.get<irt::name_str>(id).sv() != s.id) return ret;
        if (s.id == desc.spec.primary && desc.spec.method == irt::optimization_method::simple && resource.objective.simple_params.primary != id) return ret;
        if (s.id == desc.spec.primary && desc.spec.method == irt::optimization_method::epsilon_constrained && resource.objective.epsilon_constrained_params.primary != id) return ret;
    }
    ret.complete = resource.sim.models.size() == desc.targets.size() &&
      (desc.spec.method == irt::optimization_method::weighted_sum || resource.selections.exists(
          desc.spec.method == irt::optimization_method::simple ? resource.objective.simple_params.primary : resource.objective.epsilon_constrained_params.primary)) &&
      resource.objective.method == desc.spec.method && resource.objective.type == desc.spec.direction;
    return ret;
}

wrapper_binding bind_wrapper(irt::simulation& parent, irt::model_id model,
                              const irt::component_access& ids, const descriptor& desc,
                              const experiment_spec& occurrence)
{
    require(ids.exists(desc.component) && ids.components[desc.component].type == irt::component_type::simulation &&
            ids.components[desc.component].id.sim_id == desc.simulation && ids.sim_components.exists(desc.simulation),
            "Invalid component_id -> simulation_component_id association");
    const auto& source = ids.sim_components.get(desc.simulation);
    const auto count = validate_experiment(source.pj, desc.targets, occurrence);
    require(occurrence.factors.size() == desc.spec.factors.size() && occurrence.selections.size() == desc.spec.selections.size(),
            "Occurrence dimensions must match the connected definition");
    require(parent.models.exists(model) && parent.models.get(model).type == irt::dynamics_type::simulation_wrapper,
            "Expected a parent wrapper model");
    auto& wrapper = irt::get_dyn<irt::simulation_wrapper>(parent.models.get(model));
    require(wrapper.state == irt::simulation_wrapper::run_state::uninitialized,
            "Bind wrappers before parent initialize");
    require(parent.sims.exists(wrapper.sim_id) &&
            parent.parameters[model].integers[irt::simulation_wrapper_tag::id] == irt::ordinal(wrapper.sim_id),
            "project::set did not associate the wrapper resource");
    require(wrapper.x.size() == occurrence.factors.size() + 2 &&
            wrapper.y.size() == occurrence.output_count(), "Invalid connected wrapper dimensions");
    const auto after_set = audit_copy(parent.sims.get(wrapper.sim_id), desc);
    const auto old_id = wrapper.sim_id;
    const auto old_run = wrapper.run;
    const auto old_parameters = parent.parameters[model];
    // Allocate a fresh resource for EVERY occurrence. No reference into sims
    // survives grow, which may relocate all existing embedded_simulation objects.
    require(parent.sims.can_alloc(1) || parent.sims.grow<2, 1>(1), "Resource capacity exceeded");
    auto& resource = parent.sims.alloc();
    const auto resource_id = parent.sims.get_id(resource);
    try {
        checked(source.copy_to(resource), "simulation_component::copy_to");
        const auto after_copy = audit_copy(resource, desc);
        require(resource.sim.models.size() == source.pj.sim.models.size(), "copy_to omitted prototype models");
        require(resource.sim.limits.begin() == source.pj.sim.limits.begin() &&
                resource.sim.limits.end() == source.pj.sim.limits.end(), "copy_to changed prototype horizon");
        configure(resource.factors, resource.selections, resource.objective, source.pj, desc.targets, occurrence);
        if(occurrence.seed) resource.seed=*occurrence.seed;
        for (const auto& [path, target] : desc.targets)
            require(resource.sim.models.exists(target.model) &&
                    resource.sim.models.get(target.model).type == source.pj.sim.models.get(target.model).type,
                    "Prototype copy changed local model identifiers");
        wrapper.sim_id = resource_id;
        wrapper.run = occurrence.mode;
        wrapper.required_inputs = occurrence.required_inputs;
        parent.parameters[model].integers[irt::simulation_wrapper_tag::id] = irt::ordinal(resource_id);
        parent.parameters[model].integers[irt::simulation_wrapper_tag::run] = irt::ordinal(occurrence.mode);
        parent.parameters[model].reals[1] = occurrence.required_inputs;
        wrapper_binding ret{model, resource_id, after_set, after_copy, count};
        validate_binding(parent, ret, occurrence);
        return ret;
    } catch (...) {
        wrapper.sim_id = old_id;
        wrapper.run = old_run;
        wrapper.required_inputs = static_cast<unsigned>(old_parameters.reals[1]);
        parent.parameters[model] = old_parameters;
        parent.sims.free(resource_id);
        throw;
    }
}

void validate_binding(const irt::simulation& parent, const wrapper_binding& binding,
                       const experiment_spec& spec)
{
    require(parent.models.exists(binding.wrapper) && parent.sims.exists(binding.resource), "Missing bound resource/model");
    const auto& wrapper = irt::get_dyn<irt::simulation_wrapper>(parent.models.get(binding.wrapper));
    const auto& resource = parent.sims.get(binding.resource);
    require(wrapper.sim_id == binding.resource && wrapper.run == spec.mode && wrapper.scenario_results == spec.scenario_results && wrapper.required_inputs == spec.required_inputs &&
            parent.parameters[binding.wrapper].integers[irt::simulation_wrapper_tag::id] == irt::ordinal(binding.resource) &&
            parent.parameters[binding.wrapper].integers[irt::simulation_wrapper_tag::run] == irt::ordinal(spec.mode),
            "Wrapper parameters and dynamics disagree");
    require(wrapper.x.size() == spec.factors.size() + 2 && wrapper.y.size() == spec.output_count(),
            "Bound port dimensions changed");
    require(resource.factors.size() == spec.factors.size() && resource.selections.size() == spec.selections.size(),
            "Incomplete runtime factors/selections");
    for (const auto id : resource.factors) require(resource.sim.models.exists(resource.factors.get<irt::model_id>(id)), "Foreign factor model id");
    std::size_t slot = 0;
    for (const auto id : resource.selections) {
        require(irt::get_index(id) == slot++, "Sparse selection ids");
        require(resource.sim.models.exists(resource.selections.get<irt::model_id>(id)), "Foreign selection model id");
    }
    require(resource.objective.method == spec.method && resource.objective.type == spec.direction, "Runtime objective mismatch");
    if (spec.method != irt::optimization_method::weighted_sum)
        require(resource.selections.exists(spec.method == irt::optimization_method::simple ?
            resource.objective.simple_params.primary : resource.objective.epsilon_constrained_params.primary), "Invalid runtime primary");
}

void release_unreferenced_resources(irt::simulation& parent)
{
    std::set<irt::embedded_simulation_id> used;
    for (const auto& model : parent.models) if (model.type == irt::dynamics_type::simulation_wrapper) {
        const auto id = irt::get_dyn<irt::simulation_wrapper>(model).sim_id;
        require(parent.sims.exists(id) && used.insert(id).second, "Wrappers still share a resource");
    }
    std::vector<irt::embedded_simulation_id> unused;
    for (const auto& resource : parent.sims) {
        const auto id = parent.sims.get_id(resource);
        if (!used.contains(id)) unused.push_back(id);
    }
    for (const auto id : unused) parent.sims.free(id);
}

void collect_outputs(const irt::simulation& sim, const std::vector<wrapper_binding>& bindings,
                      std::size_t bag, std::vector<output_event>& events)
{
    if (sim.current_time_expired() || sim.immediate_models.empty()) return;
    for (const auto& binding : bindings) {
        const auto& wrapper = irt::get_dyn<irt::simulation_wrapper>(sim.models.get(binding.wrapper));
        for (int port = 0; port < wrapper.y.size(); ++port) {
            const auto id = wrapper.y[port];
            if (std::find(sim.active_output_ports.begin(), sim.active_output_ports.end(), id) == sim.active_output_ports.end()) continue;
            const auto* output = sim.output_ports.try_to_get(id);
            require(output != nullptr, "Active wrapper output is missing");
            const auto& msg = output->msg;
            events.push_back({binding.wrapper, sim.current_time(), static_cast<std::size_t>(port), bag,
                              {msg[0], msg[1], msg[2]}});
        }
    }
}
} // namespace irt_web
