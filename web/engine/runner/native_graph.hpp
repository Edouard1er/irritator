#pragma once

#include <irritator/core.hpp>
#include <irritator/modeling.hpp>

#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>

// In-memory graph construction shared by the JSON adapter and experiments.
// Only project::set expands coupled components into executable DEVS models.
namespace irt_web {
inline void require(bool condition, const std::string& message)
{
    if (!condition) throw std::runtime_error(message);
}

inline void checked(irt::status status, const char* operation)
{
    if (status.has_error())
        throw std::runtime_error(std::string(operation) + " (category=" +
          std::to_string(static_cast<int>(status.error().cat())) + ", code=" +
          std::to_string(status.error().value()) + ")");
}

struct native_target {
    irt::tree_node_id tree{};
    irt::model_id model{};
};
using target_table = std::map<std::string, native_target>;

inline irt::generic_component& generic(irt::component_access& ids,
                                      irt::component_id id)
{
    require(ids.exists(id) && ids.components[id].type == irt::component_type::generic,
            "Expected a generic component");
    return ids.generic_components.get(ids.components[id].id.generic_id);
}

inline irt::component_id declare_component(irt::component_access& ids)
{
    require(ids.can_alloc_generic_component(1), "Component capacity exceeded");
    return ids.alloc_generic_component();
}

template<class Type>
irt::child_id add_child(irt::generic_component& gen, Type type,
                        std::string_view name)
{
    require(!name.empty() && name.size() < 32 && name.find('/') == name.npos,
            "Native child name must fit name_str and contain no slash");
    for (const auto& child : gen.children)
        require(gen.children_names[gen.children.get_id(child)].sv() != name,
                "Duplicate native child name");
    require(gen.grow_children(), "Child capacity exceeded");
    const auto id = gen.children.get_id(gen.alloc(type));
    gen.children_names[id] = name;
    return id;
}

inline void collect_targets(const irt::component_access& ids, irt::project& pj,
                            irt::tree_node& tree, const std::string& prefix,
                            target_table& targets)
{
    const auto& component = ids.components[tree.id];
    require(component.type == irt::component_type::generic,
            "Native graph adapter supports generic components");
    const auto& gen = ids.generic_components.get(component.id.generic_id);
    for (const auto& child : gen.children) {
        const auto id = gen.children.get_id(child);
        const auto path = prefix + std::string(gen.children_names[id].sv());
        const auto& node = tree.children[id];
        if (node.is_tree_node()) collect_targets(ids, pj, *node.tn, path + "/", targets);
        else {
            require(node.is_model() && pj.sim.models.exists(node.mdl),
                    "project::set omitted a model at " + path);
            require(targets.emplace(path, native_target{pj.tree_nodes.get_id(tree), node.mdl}).second,
                    "Duplicate native instance path");
        }
    }
}

inline target_table build_project(irt::project& pj, const irt::component_access& ids,
                                  const irt::file_access& files,
                                  irt::component_id root, int connections = 512)
{
    // Rebuilding a project with live resources is deliberately disallowed:
    // simulation::clear does not clear sims. Use a fresh project per build.
    require(pj.sim.models.empty() && pj.sim.sims.empty(), "Build requires a fresh project");
    require(pj.sim.grow_connections_to(connections), "Connection capacity exceeded");
    checked(pj.set(ids, files, root), "project::set");
    auto* head = pj.tree_nodes.try_to_get(pj.tn_head());
    require(head != nullptr, "project::set omitted the root");
    target_table ret;
    collect_targets(ids, pj, *head, "", ret);
    require(ret.size() == pj.sim.models.size(), "Incomplete native model mapping");
    std::set<irt::model_id> distinct;
    for (const auto& [path, target] : ret)
        require(distinct.insert(target.model).second, "Aliased native model at " + path);
    return ret;
}
} // namespace irt_web
