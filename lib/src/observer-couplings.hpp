// Native graph preparation only. No call from an atomic transition.
namespace {
bool observer_qss(const model& m) noexcept
{
    return m.type == dynamics_type::qss1_integrator or m.type == dynamics_type::qss2_integrator or m.type == dynamics_type::qss3_integrator;
}
template<class F> void observer_edges(const simulation& sim, F&& f) noexcept
{
    for (const auto& m : sim.models) dispatch(m, [&]<class D>(const D& dyn) {
        if constexpr (has_output_port<D>) for (int op = 0; op < length(dyn.y); ++op)
            sim.for_each(dyn.y[op], [&](const model& dst, int ip) { f(m, op, dst, ip); });
    });
}
struct observer_binding { model_id source = undefined<model_id>(); sz count = 0; bool valid = true; };
observer_binding observer_binding_of(const simulation& sim, model_id id) noexcept
{
    observer_binding b;
    observer_edges(sim, [&](const model& src, int op, const model& dst, int ip) {
        if (sim.models.get_id(dst) == id and ip == 0) {
            ++b.count; b.source = sim.models.get_id(src);
            b.valid = b.valid and observer_qss(src) and op == 0;
        }
    });
    return b;
}
sz observer_edge_count(const simulation& sim, model_id src, int op, model_id dst, int ip) noexcept
{
    sz count = 0;
    observer_edges(sim, [&](const model& a, int ap, const model& b, int bp) {
        if (sim.models.get_id(a) == src and ap == op and sim.models.get_id(b) == dst and bp == ip) ++count;
    });
    return count;
}
}
status validate_structure(const simulation& sim) noexcept
{
    bool valid = true;
    for (const auto& m : sim.models) if (m.type == dynamics_type::state_observer) {
        const auto id = sim.models.get_id(m);
        const auto b = observer_binding_of(sim, id);
        // Identity is exact in the three-real transport. Refuse exhaustion.
        valid = valid and b.valid and b.count <= 1 and static_cast<u64>(id) <= 9007199254740991ULL;
        if (b.count == 1)
            valid = valid and observer_edge_count(sim, id, 2, b.source, 2) <= 1 and
                              observer_edge_count(sim, b.source, 1, id, 3) <= 1;
    }
    observer_edges(sim, [&](const model& src, int op, const model& dst, int ip) {
        const auto sid = sim.models.get_id(src), did = sim.models.get_id(dst);
        if (src.type == dynamics_type::state_observer and op == 2)
            valid = valid and observer_qss(dst) and ip == 2 and observer_binding_of(sim, sid).source == did;
        if (dst.type == dynamics_type::state_observer and ip == 3)
            valid = valid and observer_qss(src) and op == 1 and observer_binding_of(sim, did).source == sid;
        if (observer_qss(dst) and ip == 2)
            valid = valid and src.type == dynamics_type::state_observer and op == 2 and observer_binding_of(sim, sid).source == did;
        if (observer_qss(src) and op == 1)
            valid = valid and dst.type == dynamics_type::state_observer and ip == 3 and observer_binding_of(sim, did).source == sid;
    });
    if (not valid) return make_error(simulation_errc::state_observer_source_error);
    for (const auto& resource : sim.sims) irt_check(validate_structure(resource.sim));
    return success();
}
status materialize_observer_couplings(simulation& sim) noexcept
{
    irt_check(validate_structure(sim));
    for (auto& m : sim.models) if (m.type == dynamics_type::state_observer) {
        const auto id = sim.models.get_id(m);
        const auto source = observer_binding_of(sim, id).source;
        if (not is_defined(source)) continue;
        auto& qss = sim.models.get(source);
        if (not observer_edge_count(sim, id, 2, source, 2)) irt_check(sim.connect(m, 2, qss, 2));
        if (not observer_edge_count(sim, source, 1, id, 3)) irt_check(sim.connect(qss, 1, m, 3));
    }
    for (auto& resource : sim.sims) irt_check(materialize_observer_couplings(resource.sim));
    return success();
}
