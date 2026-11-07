#include "fixtures.hpp"
#include <cmath>
#include <iostream>

namespace wrapper_test {
namespace {
void near(double actual, double expected) {
    require(std::isfinite(actual) && std::abs(actual - expected) < 1e-9,
        "Native result: " + std::to_string(actual) + " expected " + std::to_string(expected));
}
void command(fixture& f, double at, double value, int port) {
    auto& sim=f.parent.sim;
    require(sim.grow_models_to(static_cast<int>(sim.models.size()+1)), "Command allocation");
    auto& source=irt::get_model(sim.alloc<irt::constant>());
    sim.parameters[sim.models.get_id(source)].set_constant(value,at);
    checked(sim.connect(source,0,sim.models.get(f.bindings[0].wrapper),port),"Command connection");
}
void factors() {
    using F=irt::factor_type;
    for(auto t:{F::single,F::single_add,F::single_mult,F::fixed,F::fixed_add,F::fixed_mult,F::random,F::random_add,F::random_mult}) {
        for(bool external:{false,true}) {
            auto p=affine_plan(); auto& factor=p.factors[0]; factor.type=t;
            factor.values=single_type(t)?std::vector<double>{2}:std::vector<double>{1,2};
            factor.random.count=3; factor.random.dist=irt::distribution_type::uniform_int; factor.random.ints={2,2};
            auto f=make_affine(false,p); if(external) command(*f,.5,3,2);
            f->initialize(); f->finish();
            const bool add=t==F::single_add||t==F::fixed_add||t==F::random_add;
            const bool mult=t==F::single_mult||t==F::fixed_mult||t==F::random_mult;
            const double expected=external?(add?5:mult?6:3):2;
            near(f->events[2].value[0],expected); near(f->events[0].value[0],1+2*expected);
        }
    }
    auto p=affine_plan(); p.factors.push_back({"initial","X",{1,2}});
    auto f=make_affine(false,p); f->initialize();
    auto& resource=f->parent.sim.sims.get(f->bindings[0].resource);
    require(resource.embedded_sims.size()==6,"Cartesian product");
    size_t i=0;
    for(auto id:resource.embedded_sims) {
        const auto& sim=resource.embedded_sims.get<irt::simulation>(id);
        near(sim.parameters[f->prospective.targets.at("u").model].reals[0],p.factors[0].values[i%3]);
        near(sim.parameters[f->prospective.targets.at("X").model].reals[0],p.factors[1].values[i/3]); ++i;
    }
    f->finish(); require(f->events.size()==4,"Cartesian outputs");
    near(f->events[3].value[1],.01); // Preserve native parameter triplet.
}
void feedback_initialization() {
    for (const bool fixed : {false, true}) {
        auto p = affine_plan();
        p.factors.push_back({"initial", "X", fixed ? std::vector<double>{-777, -666} : std::vector<double>{-777}});
        p.factors.back().type = fixed ? irt::factor_type::fixed : irt::factor_type::single;
        auto f = make_affine(false, p);
        command(*f, .5, 12, 3); command(*f, 1.5, 10, 3);
        command(*f, 2, 0, 1);
        f->initialize();
        const auto inspect = [&](double initial) {
            auto& resource = f->parent.sim.sims.get(f->bindings[0].resource);
            const auto x = f->prospective.targets.at("X").model;
            const auto u = f->prospective.targets.at("u").model;
            near(resource.sim.parameters[x].reals[0], 1);
            require(resource.embedded_sims.size() == (fixed ? 6u : 3u), "Initialization changed scenario cardinality");
            size_t i = 0;
            for (const auto id : resource.embedded_sims) {
                const auto& sim = resource.embedded_sims.get<irt::simulation>(id);
                const auto rate = p.factors[0].values[i++ % 3];
                near(sim.parameters[x].reals[0], initial);
                near(sim.parameters[x].reals[1], .01);
                near(sim.parameters[u].reals[0], rate);
                near(sim.parameters[u].reals[1], 0); // constant offset preserved
                require(&sim.parameters[x] != &resource.sim.parameters[x], "Child parameters alias prototype");
                const auto& mdl = sim.models.get(x);
                const auto& dyn = irt::get_dyn<irt::qss3_integrator>(mdl);
                near(dyn.observation(2, 2 - mdl.tl).value, initial + 2 * rate);
            }
        };
        while (f->events.size() < 4 && !f->parent.sim.current_time_expired()) f->step();
        require(f->events.size() == 4, "Missing first initialization campaign"); inspect(12);
        f->finish(); require(f->events.size() == 8, "Missing second initialization campaign"); inspect(10);
        near(f->events[0].value[0], 14); near(f->events[4].value[0], 12);
    }
}
void feedback_loop() {
    auto p = affine_plan(); p.scenario_results = true;
    p.factors.push_back({"initial", "X", {-777}}); p.factors.back().type = irt::factor_type::single;
    auto f = make_affine(false, p);
    auto& s = f->parent.sim;
    require(s.grow_models_to(128) && s.grow_connections_to(1024), "Feedback graph capacity");
    auto& wrapper_model = s.models.get(f->bindings[0].wrapper);
    auto& wrapper = irt::get_dyn<irt::simulation_wrapper>(wrapper_model);
    auto& read1 = s.models.get(f->parent_targets.at("run").model);
    s.disconnect(read1, 0, wrapper_model, 1);
    auto& x = s.alloc<irt::qss3_integrator>(); s.parameters[s.get_id(x)].set_integrator(10, .01);
    auto& hold = s.alloc<irt::zero_order_hold>();
    auto& sample = s.alloc<irt::state_observer>();
    auto& memory = s.alloc<irt::value_memory>(); s.parameters[s.get_id(memory)].integers[0] = 1;
    auto& init = s.alloc<irt::event_operator>();
    s.parameters[s.get_id(init)].integers[0] = 3; s.parameters[s.get_id(init)].reals[1] = 0;
    auto& run = s.alloc<irt::event_operator>();
    auto& distance = s.alloc<irt::event_operator>();
    s.parameters[s.get_id(distance)].integers[0] = 2; s.parameters[s.get_id(distance)].reals[1] = 10.5;
    auto& absolute = s.alloc<irt::event_operator>(); s.parameters[s.get_id(absolute)].integers[0] = 16;
    auto& negative = s.alloc<irt::event_operator>();
    s.parameters[s.get_id(negative)].integers[0] = 3; s.parameters[s.get_id(negative)].reals[1] = -1;
    auto& filter = s.alloc<irt::candidate_filter>(); s.parameters[s.get_id(filter)].integers[0] = 3;
    auto& select = s.alloc<irt::candidate_select>(); s.parameters[s.get_id(select)].integers[2] = 0;
    auto& initial = s.alloc<irt::constant>(); s.parameters[s.get_id(initial)].set_constant(2, 0);
    auto& read2 = s.alloc<irt::constant>(); s.parameters[s.get_id(read2)].set_constant(0, 3);
    const auto wire = [&](auto& a, int ap, auto& b, int bp) { checked(s.connect(irt::get_model(a), ap, irt::get_model(b), bp), "Feedback connection"); };
    checked(s.connect(read1, 0, irt::get_model(sample), 1), "First feedback read");
    wire(read2, 0, sample, 1); wire(initial, 0, hold, 0); wire(select, 0, hold, 0); wire(hold, 0, x, 0);
    wire(x, 0, sample, 0); wire(sample, 0, memory, 0); wire(memory, 0, wrapper, 3); wire(memory, 0, init, 0);
    wire(init, 0, wrapper, 0); wire(init, 0, run, 0); wire(run, 0, wrapper, 1);
    wire(wrapper, 7, distance, 0); wire(wrapper, 9, distance, 3); wire(wrapper, 5, filter, 1);
    wire(distance, 0, absolute, 0); wire(distance, 2, absolute, 3); wire(absolute, 0, negative, 0); wire(absolute, 2, negative, 3);
    wire(negative, 0, filter, 0); wire(negative, 2, filter, 3); wire(filter, 0, select, 0); wire(filter, 1, select, 1); wire(filter, 2, select, 2);
    for (int port = 0; port < wrapper.y.size(); ++port) if (!irt::is_defined(wrapper.y[port])) {
        auto& sink = s.alloc<irt::counter>(); wire(wrapper, port, sink, 0);
    }
    s.limits.set_bound(0, 5); f->initialize();
    std::vector<std::array<double, 2>> observations, actions;
    while (!s.current_time_expired()) {
        f->step(); if (s.current_time_expired()) break;
        for (const auto port : s.active_output_ports) {
            if (port == sample.y[0]) observations.push_back({s.current_time(), s.output_ports.get(port).msg[0]});
            if (port == hold.y[0]) actions.push_back({s.current_time(), s.output_ports.get(port).msg[0]});
        }
    }
    checked(s.finalize(), "Feedback finalize");
    require(observations.size() == 2 && observations[0][0] == 1 && observations[1][0] == 3, "Real native feedback observation dates");
    near(observations[0][1], 12); near(observations[1][1], 10);
    require(actions == std::vector<std::array<double, 2>>{{0,2},{1,-1},{3,0}}, "Actual DEVS actions or dates differ");
    near(x.observation(5, 5 - irt::get_model(x).tl).value, 10);
    size_t count = 0;
    for (const auto& event : f->events) if (event.port == 6) {
        const auto campaign = event.value[2];
        require((campaign == 1 && event.time == 1) || (campaign == 2 && event.time == 3), "Native prospective campaign date");
        near(event.value[0], campaign == 1 ? 12 : 10);
        ++count;
    }
    require(count == 6, "Missing actual prospective scenario inputs");
    std::cout << "NATIVE FEEDBACK observation=[(1,12),(3,10)] hold=[(0,2),(1,-1),(3,0)] X(5)=10\n";
}
void distributions() {
    std::cout.precision(17);
    using D=irt::distribution_type;
    for(auto d:{D::uniform_int,D::uniform_real,D::bernouilli,D::binomial,D::negative_binomial,D::geometric,D::poisson,D::exponential,D::gamma,D::weibull,D::exterme_value,D::normal,D::lognormal,D::chi_squared,D::cauchy,D::fisher_f,D::student_t}) {
        auto p=affine_plan(); for(auto& s:p.selections) s.target="u";
        p.seed=std::array<irt::u64,6>{18446744073709551615ull,9007199254740993ull,0,0,0,0};
        auto& factor=p.factors[0]; factor.type=irt::factor_type::random;
        factor.random.count=4; factor.random.dist=d; factor.random.reals={.5,1}; factor.random.ints={2,4};
        auto seed=*p.seed; const auto expected=factor.random.gen(seed);
        auto f=make_affine(false,p,true), g=make_affine(false,p,true);
        require(f->parent.sim.sims.get(f->bindings[0].resource).seed==*p.seed,"Exact uint64 seed before initialize");
        f->initialize(); g->initialize(); f->finish(); g->finish();
        auto& resource=f->parent.sim.sims.get(f->bindings[0].resource);
        size_t i=0;
        for(auto id:resource.embedded_sims) near(resource.embedded_sims.get<irt::simulation>(id).parameters[f->prospective.targets.at("u").model].reals[0],expected[i++]);
        require(f->events.size()==3 && g->events.size()==3,"Random native outputs");
        for(size_t j=0;j<3;++j) near(f->events[j].value[0],g->events[j].value[0]);
        near(f->events[2].value[0],*std::max_element(expected.begin(),expected.end()));
        std::cout<<"DISTRIBUTION "<<static_cast<int>(d)<<" selected="<<f->events[2].value[0]<<'\n';
        // Reset consumes the current stream instead of rewinding its initial seed.
        const auto before=resource.seed; f->initialize(); require(resource.seed!=before,"Native random state advances on reset"); f->finish();
    }
}
using R=irt::simulation_wrapper::run_type;
irt::embedded_simulation& embedded(fixture& f) { return f.parent.sim.sims.get(f.bindings[0].resource); }
void run_source(fixture& f, double at, double value) {
    f.parent.sim.parameters[f.parent_targets.at("run").model].set_constant(value,at);
}
void modes() {
    for(auto mode:{R::complete,R::bag,R::time,R::until,R::during}) {
        auto p=affine_plan(); p.mode=mode;
        for(auto& s:p.selections) s.target="u";
        auto f=make_affine(false,p,true); auto& prototype=embedded(*f).sim;
        prototype.limits.set_bound(10,12);
        // Unconnected native constants make known scheduler bags at 10.5/11/11.5.
        for(double offset:{.5,1.,1.5}) {
            require(prototype.grow_models_to(static_cast<int>(prototype.models.size()+1)),"Clock source allocation");
            auto& source=irt::get_model(prototype.alloc<irt::constant>());
            prototype.parameters[prototype.models.get_id(source)].set_constant(0,offset);
        }
        const double arg=mode==R::until?10.75:mode==R::during?.75:0;
        run_source(*f,5,arg); f->parent.sim.limits.set_bound(0,30);
        f->initialize(); f->finish();
        const double expected=mode==R::complete?12:mode==R::bag?10:mode==R::time?10.5:11;
        require(f->events.size()==3,"Mode emits three native outputs");
        for(auto id:embedded(*f).embedded_sims) {
            const auto& child=embedded(*f).embedded_sims.get<irt::simulation>(id);
            std::cout<<"MODE "<<static_cast<int>(mode)<<" child="<<child.current_time()<<" parent="<<f->events[0].time<<'\n';
            near(child.current_time(),expected);
        }
        near(f->events[0].time,5+arg);
        near(f->events[0].value[0],1);
        near(f->parent.sim.current_time(),30);
    }
    // Absolute until does not reinterpret a past target as a relative duration.
    auto p=affine_plan(); p.mode=R::until;
    auto f=make_affine(false,p); embedded(*f).sim.limits.set_bound(10,12);
    run_source(*f,5,.75); f->parent.sim.limits.set_bound(0,10);
    f->initialize(); f->finish();
    for(auto id:embedded(*f).embedded_sims) near(embedded(*f).embedded_sims.get<irt::simulation>(id).current_time(),10);
    near(f->events[0].time,5.75); near(f->events[0].value[0],1);
}
void commands() {
    for(auto mode:{R::complete,R::bag,R::time,R::until,R::during}) for(bool init:{false,true}) {
        auto p=affine_plan(false,{2}); p.mode=mode;
        auto f=make_affine(false,p); command(*f,.5,5,2); if(init) command(*f,.75,0,0);
        f->initialize(); f->finish();
        const auto u=f->prospective.targets.at("u").model;
        for(auto id:embedded(*f).embedded_sims)
            near(embedded(*f).embedded_sims.get<irt::simulation>(id).parameters[u].reals[0],mode==R::complete||init?5:2);
        require(f->events.size()==3,"Partial commands retain native decisions");
    }
    // Simultaneous init/factor/two run sources: one command, minimum run scalar.
    auto f=make_affine(); run_source(*f,1,3); command(*f,1,1,1); command(*f,1,5,2); command(*f,1,0,0);
    f->initialize(); f->finish(); require(f->events.size()==3,"One request per bag"); near(f->events[0].time,2);near(f->events[2].value[0],5);
    // Overlap with different values: each response is a snapshot; order by due.
    auto g=make_affine(); run_source(*g,1,2); command(*g,1.5,2,2); command(*g,2,0,1);
    g->parent.sim.limits.set_bound(0,4); g->initialize();g->finish();require(g->events.size()==6,"Overlapping responses");
    near(g->events[0].time,2);near(g->events[2].value[0],2);near(g->events[3].time,3);near(g->events[5].value[0],1);
    // Equal due dates remain separate native bags.
    auto h=make_affine();run_source(*h,1,2);command(*h,2,1,1);h->parent.sim.limits.set_bound(0,4);
    h->initialize();h->finish();require(h->events.size()==6,"Equal due responses");
    near(h->events[0].time,3);near(h->events[3].time,3);require(h->events[0].bag<h->events[3].bag,"Distinct bags at one date");
    // init cancels deferred responses; no command emits no decision.
    auto k=make_affine();run_source(*k,1,2);command(*k,1.5,0,0);command(*k,2,0,1);
    k->parent.sim.limits.set_bound(0,4);k->initialize();k->finish();require(k->events.size()==3,"Init cancels pending response");near(k->events[0].time,2);
    auto n=make_affine();run_source(*n,10,0);n->initialize();n->finish();require(n->events.empty(),"No command means no event");
}
void objectives() {
    // X(t)=1+u*t, u in {-1,0,1}, t in [0,2]. Raw columns:
    // terminal={-1,1,3}, minimum={-1,1,1}. All assertions use real engines.
    for (auto norm : {irt::norm_type::min_max, irt::norm_type::z_score}) {
        for (auto direction : {irt::optimization_type::maximize, irt::optimization_type::minimize}) {
            auto p = affine_plan(); p.method = irt::optimization_method::weighted_sum;
            p.primary.clear(); p.weights = {2,1}; p.types = {irt::optimization_type::maximize, irt::optimization_type::minimize};
            p.norm = norm; p.direction = direction;
            auto f = make_affine(false, p); f->initialize(); f->finish();
            const bool max = direction == irt::optimization_type::maximize;
            const double a = norm == irt::norm_type::min_max ? (max ? 1. : 0.) : (max ? std::sqrt(1.5) : -std::sqrt(1.5));
            const double b = norm == irt::norm_type::min_max ? (max ? 0. : 1.) : (max ? -1/std::sqrt(2.) : std::sqrt(2.));
            require(f->events.size() == 3, "Weighted native events");
            near(f->events[0].value[0], a); near(f->events[1].value[0], b); near(f->events[2].value[0], max ? 1 : -1);
        }
    }
    // A weight change changes the selected native parameter; ties retain first.
    for (auto weights : {std::vector<double>{0,1}, std::vector<double>{0,0}}) {
        auto p = affine_plan(); p.method = irt::optimization_method::weighted_sum;
        p.weights = weights; p.types = {irt::optimization_type::maximize, irt::optimization_type::minimize};
        auto f = make_affine(false, p); f->initialize(); f->finish(); near(f->events[2].value[0], -1);
    }
    struct constraint { std::vector<double> eps; std::vector<irt::operation_type> ops; double rate; bool emits = true; };
    using O = irt::operation_type;
    for (const auto& c : {constraint{{1,1},{O::less_equal,O::greater_equal},0},
                           constraint{{1,1},{O::equal,O::equal},0},
                           constraint{{3,1},{O::not_equal,O::equal},0},
                           constraint{{0,2},{O::greater_equal,O::greater_equal},0,false},
                           constraint{{2,1},{O::equal,O::equal},0,false}}) {
        auto p = affine_plan(); p.method = irt::optimization_method::epsilon_constrained;
        p.epsilons = c.eps; p.operations = c.ops;
        auto f = make_affine(false,p); f->initialize(); f->finish();
        require(f->events.size() == (c.emits ? 3u : 0u), "No feasible candidate means no event, never zero");
        if(c.emits) near(f->events[2].value[0],c.rate);
    }
    auto p = affine_plan(); p.method = irt::optimization_method::epsilon_constrained;
    p.direction = irt::optimization_type::minimize; p.epsilons = {-1,-1}; p.operations = {O::greater_equal,O::greater_equal};
    auto f = make_affine(false,p); f->initialize(); f->finish(); near(f->events[2].value[0],-1);
    std::cout << "OBJECTIVES native normalized columns, weights, directions, constraints, ties, empty candidates PASS\n";
}
}
void advanced_case(const std::string& name) {
    if(name == "objectives") objectives();
    else if(name == "factors") factors();
    else if(name == "feedback") feedback_initialization();
    else if(name == "feedback-loop") feedback_loop();
    else if(name == "distributions") distributions();
    else if(name == "modes") modes();
    else if(name == "commands") commands();
    else throw std::runtime_error("Unknown test case: " + name);
}
}
