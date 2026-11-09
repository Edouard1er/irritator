// Scientific JSON v3 compiler. Native binding and event collection stay in 7B's
// native_wrapper API; no experiment or DEVS execution is implemented here.
struct json_wrappers {
    struct occurrence {
        std::string path;
        const V* component;
        irt_web::experiment_spec plan;
    };
    const D& doc;
    const D& catalog;
    std::unique_ptr<native_hierarchy> parent;
    std::map<std::string,const V*> definitions;
    std::map<const V*,irt_web::experiment_spec> plans;
    std::map<const V*,irt_web::descriptor> descriptors;
    std::vector<std::unique_ptr<D>> prototype_docs;
    std::vector<std::unique_ptr<native_hierarchy>> prototypes;
    std::vector<occurrence> occurrences;
    std::vector<irt_web::wrapper_binding> bindings;
    std::vector<irt_web::output_event> events;
    unsigned collector_models=0;

    const V& definition(const std::string& id) const {
        const auto it=definitions.find(id);
        if(it==definitions.end()) fail("DEFINITION_NOT_FOUND","Unknown definition: "+id);
        return *it->second;
    }
    const V& target(const V& scope,const std::string& path,const char* code) const {
        const V* current=&scope;
        std::size_t begin=0;
        while(true) {
            const auto end=path.find('/',begin);
            const auto name=path.substr(begin,end==path.npos?end:end-begin);
            const V* found=nullptr;
            for(const auto& c:(*current)["components"].GetArray()) if(str(c["id"])==name) { found=&c; break; }
            if(!found) fail(code,"Unknown instance path: "+path);
            if(end==path.npos) return *found;
            if(str((*found)["type"])!="coupled") fail(code,"Instance path traverses an atomic model: "+path);
            current=&definition(str((*found)["definition"])); begin=end+1;
        }
    }
    static void horizon(const V& h) {
        const auto start=h["start"].GetDouble(),end=h["end"].GetDouble();
        if(!std::isfinite(start)||!std::isfinite(end)||!(end>start)||end-start>1e9)
            fail("INVALID_TIME","Expected finite start < end and horizon <= 1e9");
    }
    void factor_values(const V& f,const V& atomic,irt_web::factor_spec& native) const {
        native.values.clear();
        using F=irt::factor_type;
        const std::map<std::string,F> types{{"single",F::single},{"single-add",F::single_add},{"single-mult",F::single_mult},
            {"fixed",F::fixed},{"fixed-add",F::fixed_add},{"fixed-mult",F::fixed_mult},
            {"random",F::random},{"random-add",F::random_add},{"random-mult",F::random_mult}};
        native.type=types.at(str(f["type"]));
        if(irt_web::single_type(native.type)) native.values.push_back(f["value"].GetDouble());
        else if(irt_web::random_type(native.type)) {
            using D=irt::distribution_type;
            const std::map<std::string,D> distributions{
                {"uniform-int",D::uniform_int},{"uniform-real",D::uniform_real},{"bernoulli",D::bernouilli},{"binomial",D::binomial},
                {"negative-binomial",D::negative_binomial},{"geometric",D::geometric},{"poisson",D::poisson},{"exponential",D::exponential},
                {"gamma",D::gamma},{"weibull",D::weibull},{"extreme-value",D::exterme_value},{"normal",D::normal},{"lognormal",D::lognormal},
                {"chi-squared",D::chi_squared},{"cauchy",D::cauchy},{"fisher-f",D::fisher_f},{"student-t",D::student_t}};
            native.random.count=f["count"].GetUint(); native.random.dist=distributions.at(str(f["distribution"]));
            for(unsigned i=0;i<2;++i) { native.random.reals[i]=f["reals"][i].GetDouble(); native.random.ints[i]=f["ints"][i].GetInt(); }
            try { irt_web::validate_random_factor(native.random); }
            catch(const std::exception& e) { fail("INVALID_FACTOR",e.what()); }
        }
        else for(const auto& value:f["values"].GetArray()) native.values.push_back(value.GetDouble());
        const auto& bounds=descriptor(catalog,str(atomic["type"]))["parameters"];
        const char* parameter=str(atomic["type"])=="constant"?"value":"X";
        for(double value:native.values)
            if(!std::isfinite(value)||value<bounds[parameter]["minimum"].GetDouble()||value>bounds[parameter]["maximum"].GetDouble())
                fail("INVALID_FACTOR","Factor value outside the target parameter bounds");
    }
    std::size_t scenarios(const irt_web::experiment_spec& spec) const {
        std::size_t n=1;
        for(const auto& f:spec.factors) {
            const auto count=irt_web::factor_cardinality(f);
            if(!count || n>std::size_t(limit(doc,"maxScenarios",128))/count)
                fail("LIMIT_EXCEEDED","Cartesian scenario product exceeds maxScenarios");
            n*=count;
        }
        return n;
    }
    irt_web::experiment_spec experiment(const V& e) const {
        horizon(e["simulation"]);
        irt_web::experiment_spec spec;
        using R=irt::simulation_wrapper::run_type;
        const std::map<std::string,R> modes{{"complete",R::complete},{"bag",R::bag},{"time",R::time},{"until",R::until},{"during",R::during}};
        spec.mode=modes.at(str(e["run"]));
        spec.scenario_results=e.HasMember("scenarioResults") && e["scenarioResults"].GetBool();
        spec.dynamic_plan=e.HasMember("dynamicPlan") && e["dynamicPlan"].GetBool();
        if(e.HasMember("seed")) {
            std::array<irt::u64,6> seed{};
            for(unsigned i=0;i<6;++i) {
                const auto value=str(e["seed"][i]);
                const auto [end,ec]=std::from_chars(value.data(),value.data()+value.size(),seed[i]);
                if(ec!=std::errc{}||end!=value.data()+value.size()) fail("INVALID_EXPERIMENT","Invalid uint64 seed string");
            }
            spec.seed=seed;
        }
        const auto& scope=definition(str(e["definition"]));
        const auto f=e["factors"].Size(),s=e["selections"].Size();
        if(f<1||f>10||s<1||f+s<3||f+s>12) fail("INVALID_EXPERIMENT","Require 1<=F<=10, S>=1, 3<=F+S<=12");
        std::set<std::string> names,targets;
        for(const auto& item:e["factors"].GetArray()) {
            irt_web::factor_spec native;
            native.id=str(item["id"]); native.target=str(item["target"]);
            if(!names.insert(native.id).second||!targets.insert(native.target).second) fail("INVALID_FACTOR","Duplicate factor id or target");
            const auto& atom=target(scope,native.target,"INVALID_FACTOR");
            const auto type=str(atom["type"]),parameter=str(item["parameter"]);
            if(!((type=="constant"&&parameter=="value")||
                 ((type=="qss1_integrator"||type=="qss2_integrator"||type=="qss3_integrator")&&parameter=="X")))
                fail("INVALID_FACTOR","Factor parameter must map to a validated reals[0]");
            factor_values(item,atom,native); spec.factors.push_back(std::move(native));
        }
        if(e.HasMember("requiredInputs")) {
            std::set<std::string> required;
            for(const auto& id:e["requiredInputs"].GetArray()) {
                const auto name=str(id);
                const auto it=std::find_if(spec.factors.begin(),spec.factors.end(),[&](const auto& factor){return factor.id==name;});
                if(it==spec.factors.end() || !required.insert(name).second)
                    fail("INVALID_FACTOR","Unknown or duplicate required factor input");
                spec.required_inputs |= 1u << (it-spec.factors.begin());
            }
            if(spec.required_inputs && spec.mode!=R::complete)
                fail("INVALID_EXPERIMENT","Addressed factor inputs require complete mode");
        }
        if(spec.dynamic_plan) {
            if(f>9||spec.mode!=R::complete||!spec.scenario_results)
                fail("INVALID_EXPERIMENT","Dynamic plans require F<=9, complete mode, and scenarioResults");
            unsigned observations=0;
            for(unsigned i=0;i<f;++i) {
                if(spec.factors[i].type==irt::factor_type::single) observations|=1u<<i;
                else if(spec.factors[i].type!=irt::factor_type::fixed)
                    fail("INVALID_FACTOR","Dynamic plans require direct single observations and direct fixed domains");
            }
            if(spec.required_inputs!=observations)
                fail("INVALID_EXPERIMENT","Dynamic requiredInputs must contain every single observation and no fixed domain");
        }
        names.clear();
        const std::map<std::string,irt::criteria_type> criteria{
            {"min",irt::criteria_type::min},{"max",irt::criteria_type::max},
            {"min-last",irt::criteria_type::min_last},{"max-last",irt::criteria_type::max_last}};
        for(const auto& item:e["selections"].GetArray()) {
            const auto id=str(item["id"]),path=str(item["target"]);
            if(!names.insert(id).second) fail("INVALID_SELECTION","Duplicate selection id");
            const auto& atom=target(scope,path,"INVALID_SELECTION");
            if(!registry.contains(str(atom["type"]))) fail("INVALID_SELECTION","Selection must target an observable catalogue atom");
            spec.selections.push_back({id,path,criteria.at(str(item["criteria"]))});
        }
        const auto& o=e["objective"];
        const auto method=str(o["method"]);
        spec.method=method=="simple"?irt::optimization_method::simple:method=="weighted-sum"?irt::optimization_method::weighted_sum:irt::optimization_method::epsilon_constrained;
        if(o.HasMember("primary")) spec.primary=str(o["primary"]);
        if(spec.method!=irt::optimization_method::weighted_sum&&!names.contains(spec.primary)) fail("INVALID_SELECTION","Unknown primary selection");
        spec.direction=str(o["type"])=="maximize"?irt::optimization_type::maximize:irt::optimization_type::minimize;
        if(spec.method==irt::optimization_method::weighted_sum) {
            if(o["weights"].Size()!=s||o["types"].Size()!=s) fail("INVALID_EXPERIMENT","Weighted-sum arrays must match selections");
            for(const auto& v:o["weights"].GetArray()) spec.weights.push_back(v.GetDouble());
            for(const auto& v:o["types"].GetArray()) spec.types.push_back(str(v)=="maximize"?irt::optimization_type::maximize:irt::optimization_type::minimize);
            spec.norm=str(o["norm"])=="min-max"?irt::norm_type::min_max:irt::norm_type::z_score;
        }
        if(spec.method==irt::optimization_method::epsilon_constrained) {
            if(o["epsilons"].Size()!=s||o["operations"].Size()!=s) fail("INVALID_EXPERIMENT","Epsilon arrays must cover all selections, including primary");
            const std::map<std::string,irt::operation_type> ops{{"equal",irt::operation_type::equal},{"not-equal",irt::operation_type::not_equal},{"greater-equal",irt::operation_type::greater_equal},{"less-equal",irt::operation_type::less_equal}};
            for(const auto& v:o["epsilons"].GetArray()) spec.epsilons.push_back(v.GetDouble());
            for(const auto& v:o["operations"].GetArray()) spec.operations.push_back(ops.at(str(v)));
        }
        spec.max_scenarios=limit(doc,"maxScenarios",128);
        (void)scenarios(spec);
        return spec;
    }
    // The dependency DAG includes both coupled instances and prospective refs.
    // Connection edges deliberately do not participate in this traversal.
    void dependencies(const std::string& id,std::set<std::string>& active,std::set<std::string>& done) const {
        if(active.contains(id)) fail("RECURSIVE_DEFINITION","Recursive prospective/coupled definition: "+id);
        if(done.contains(id)) return;
        active.insert(id);
        if(active.size()>16) fail("HIERARCHY_DEPTH","Combined dependency depth exceeds 16");
        for(const auto& c:definition(id)["components"].GetArray()) {
            const auto type=str(c["type"]);
            if(type=="coupled") dependencies(str(c["definition"]),active,done);
            else if(type=="simulation_wrapper") dependencies(str(c["experiment"]["definition"]),active,done);
        }
        active.erase(id); done.insert(id);
    }
    bool contains_wrapper(const V& scope) const {
        for(const auto& c:scope["components"].GetArray()) {
            if(str(c["type"])=="simulation_wrapper") return true;
            if(str(c["type"])=="coupled"&&contains_wrapper(definition(str(c["definition"])))) return true;
        }
        return false;
    }
    std::vector<occurrence> expand(const V& scope,const std::string& prefix="") const {
        std::vector<occurrence> ret;
        std::map<std::string,const V*> overrides;
        for(const auto& c:scope["components"].GetArray()) {
            const auto path=prefix+str(c["id"]),type=str(c["type"]);
            if(type=="simulation_wrapper") ret.push_back({path,&c,plans.at(&c)});
            else if(type=="coupled") {
                auto sub=expand(definition(str(c["definition"])),path+"/");
                ret.insert(ret.end(),sub.begin(),sub.end());
                if(c.HasMember("experimentOverrides")) for(const auto& item:c["experimentOverrides"].GetArray()) {
                    const auto dest=path+"/"+str(item["target"]);
                    if(!overrides.emplace(dest,&item).second) fail("INVALID_EXPERIMENT","Duplicate occurrence override");
                }
            }
            if(ret.size()>unsigned(limit(doc,"maxWrappers",8))) fail("LIMIT_EXCEEDED","Expanded wrapper budget exceeded");
        }
        for(const auto& [path,item]:overrides) {
            const auto it=std::find_if(ret.begin(),ret.end(),[&](const auto& o){return o.path==path;});
            if(it==ret.end()) fail("INVALID_REFERENCE","Override target is not a wrapper instance: "+path);
            auto& spec=it->plan;
            if(item->operator[]("factors").Size()!=spec.factors.size()) fail("INVALID_FACTOR","Override must preserve factor count and order");
            const auto& scope=definition(str((*it->component)["experiment"]["definition"]));
            for(unsigned i=0;i<spec.factors.size();++i) {
                const auto& f=(*item)["factors"][i];
                if(str(f["id"])!=spec.factors[i].id) fail("INVALID_FACTOR","Override must preserve factor ids/order");
                factor_values(f,target(scope,spec.factors[i].target,"INVALID_FACTOR"),spec.factors[i]);
            }
        }
        return ret;
    }
    void budget(const std::vector<occurrence>& list,const native_hierarchy::summary& graph) const {
        double total_scenarios=0,models=graph.atoms,edges=graph.connections,points=0;
        // project::set copies every descriptor, including unused definitions.
        // Include both descriptor and temporary parent prototype, then private
        // occurrence prototype + scenario copies + conservative collector sinks.
        for(const auto& [c,p]:plans) {
            const auto& g=parent->summaries.at(str((*c)["experiment"]["definition"]));
            models+=2*g.atoms; edges+=2*g.connections;
        }
        for(const auto& o:list) {
            const auto n=scenarios(o.plan);
            const auto& e=(*o.component)["experiment"];
            const auto& g=parent->summaries.at(str(e["definition"]));
            const auto ports=o.plan.dynamic_plan ? o.plan.output_count() : o.plan.factors.size()+o.plan.selections.size();
            total_scenarios+=n; models+=(n+1)*g.atoms+ports; edges+=(n+1)*g.connections+ports;
            std::set<std::string> selected;
            for(const auto& s:o.plan.selections) selected.insert(s.target);
            const auto start=e["simulation"]["start"].GetDouble(),end=e["simulation"]["end"].GetDouble();
            if(!(start+.1>start)||!(end+.1>end)) fail("INVALID_TIME","Internal sampling interval cannot advance time");
            points+=n*selected.size()*(std::ceil((end-start)/.1)+2);
        }
        if(total_scenarios>limit(doc,"maxTotalScenarios",256)||models>limit(doc,"maxTotalModels",8192)||
           edges>limit(doc,"maxTotalConnections",32768)||points>limit(doc,"maxInternalPoints",200000))
            fail("LIMIT_EXCEEDED","Cumulative prospective/scenario resource budget exceeded");
    }
    explicit json_wrappers(const D& d,const D& c):doc(d),catalog(c) {
        horizon(doc["simulation"]);
        for(const auto& def:doc["model"]["definitions"].GetArray())
            if(!definitions.emplace(str(def["id"]),&def).second) fail("INVALID_MODEL","Duplicate definition");
        std::set<std::string> active,done;
        for(const auto& [id,def]:definitions) dependencies(id,active,done);
        auto dimensions=[&](const V& scope) {
            for(const auto& c:scope["components"].GetArray()) if(str(c["type"])=="simulation_wrapper") {
                const auto& e=c["experiment"]; const auto f=e["factors"].Size(),s=e["selections"].Size();
                if(f<1||f>10||s<1||f+s<3||f+s>12) fail("INVALID_EXPERIMENT","Require 1<=F<=10, S>=1, 3<=F+S<=12");
            }
        };
        dimensions(doc["model"]); for(const auto& [id,def]:definitions) dimensions(*def);
        parent=std::make_unique<native_hierarchy>(doc,catalog);
        auto scan=[&](const V& scope) {
            for(const auto& atom:scope["components"].GetArray()) if(str(atom["type"])=="simulation_wrapper") {
                const auto& e=atom["experiment"];
                if(contains_wrapper(definition(str(e["definition"])))) fail("UNSUPPORTED_EXPERIMENT","Prospective wrappers are outside the validated single-level domain");
                plans.emplace(&atom,experiment(e));
                if(plans.size()>unsigned(limit(doc,"maxWrappers",8))) fail("LIMIT_EXCEEDED","Declared wrapper budget exceeded");
            }
        };
        scan(doc["model"]); for(const auto& [id,def]:definitions) scan(*def);
        for(const auto& [id,def]:definitions) budget(expand(*def),parent->summaries.at(id));
        occurrences=expand(doc["model"]);
        budget(occurrences,parent->count(doc["model"],0));
    }
    void reachable(const std::string& id,std::set<std::string>& found) const {
        if(!found.insert(id).second) return;
        for(const auto& c:definition(id)["components"].GetArray()) if(str(c["type"])=="coupled") reachable(str(c["definition"]),found);
    }
    void build() {
        try {
            // Separate workspaces avoid unrelated descriptors being copied by
            // project::set into another prospective project's simulation::sims.
            parent->prepare_access();
            for(const auto& [c,plan]:plans) {
                const auto& e=(*c)["experiment"];
                auto projected=std::make_unique<D>(rapidjson::kObjectType);
                auto& a=projected->GetAllocator();
                projected->AddMember("schemaVersion",2,a);
                V model(definition(str(e["definition"])),a);
                model.RemoveMember("name");
                model.AddMember("observations",V(rapidjson::kArrayType),a);
                V defs(rapidjson::kArrayType);
                std::set<std::string> used; reachable(str(e["definition"]),used);
                for(const auto& id:used) defs.PushBack(V(definition(id),a),a);
                model.AddMember("definitions",defs,a);
                projected->AddMember("model",model,a).AddMember("simulation",V(e["simulation"],a),a);
                if(doc.HasMember("limits")) projected->AddMember("limits",V(doc["limits"],a),a);
                auto graph=std::make_unique<native_hierarchy>(*projected,catalog,true);
                graph->build();
                graph->project->sim.limits.set_bound(e["simulation"]["start"].GetDouble(),e["simulation"]["end"].GetDouble());
                auto desc=irt_web::make_descriptor(*parent->access,std::move(*graph->project),graph->targets,plan);
                auto [it,inserted]=descriptors.emplace(c,std::move(desc));
                parent->wrapper_descriptors.emplace(c,&it->second);
                prototype_docs.push_back(std::move(projected)); prototypes.push_back(std::move(graph));
            }
            parent->build();
            auto& sim=parent->project->sim;
            for(const auto& o:occurrences) bindings.push_back(irt_web::bind_wrapper(sim,parent->models.at(o.path),*parent->access,descriptors.at(o.component),o.plan));
            irt_web::release_unreferenced_resources(sim);
            std::size_t ports=0; for(const auto& o:occurrences) ports+=o.plan.output_count();
            irt_web::require(sim.grow_models_to(static_cast<int>(sim.models.size()+ports)),"Collector model allocation failed");
            irt_web::require(sim.grow_connections_to(1024),"Collector connection allocation failed");
            // Unconnected native output ports otherwise emit no message at all.
            for(const auto& b:bindings) {
                auto& wrapper=irt::get_dyn<irt::simulation_wrapper>(sim.models.get(b.wrapper));
                for(int port=0;port<wrapper.y.size();++port) if(!irt::is_defined(wrapper.y[port])) {
                    auto& sink=irt::get_model(sim.alloc<irt::counter>());
                    irt_web::checked(sim.connect(sim.models.get(b.wrapper),port,sink,0),"Connect private event collector");
                    ++collector_models;
                }
            }
            for(std::size_t i=0;i<bindings.size();++i) irt_web::validate_binding(sim,bindings[i],occurrences[i].plan);
        } catch(const failure&) { throw; }
          catch(const std::exception& error) { fail("NATIVE_CONSTRUCTION_ERROR",error.what()); }
    }
    void collect(std::size_t bag) {
        audit_parameters();
        const auto first=events.size();
        try { irt_web::collect_outputs(parent->project->sim,bindings,bag,events); }
        catch(const std::exception& error) { fail("EXECUTION_ERROR",error.what()); }
        if(events.size()>unsigned(limit(doc,"maxResultEvents",20000))) fail("LIMIT_EXCEEDED","Wrapper result event budget exceeded");
        for(std::size_t i=first;i<events.size();++i) {
            const auto& event=events[i];
            if(!std::isfinite(event.time)||event.time<doc["simulation"]["start"].GetDouble()||event.time>=doc["simulation"]["end"].GetDouble()) fail("EXECUTION_ERROR","Invalid wrapper event time");
            for(double value:event.value) if(!std::isfinite(value)) fail("EXECUTION_ERROR","Non-finite wrapper output");
        }
    }
    void audit_parameters() const {
        const auto& parent_sim=parent->project->sim;
        for(const auto& b:bindings) {
            const auto& resource=parent_sim.sims.get(b.resource);
            for(const auto& input:resource.input_parameters)
                if(input.value && !std::isfinite(*input.value)) fail("INVALID_FACTOR","Non-finite external factor input");
            for(const auto sub:resource.embedded_sims) {
                const auto& sim=resource.embedded_sims.get<irt::simulation>(sub);
                for(const auto factor:resource.factors) {
                    const auto value=sim.parameters[resource.factors.get<irt::model_id>(factor)].reals[0];
                    if(!std::isfinite(value)||std::abs(value)>1e12) fail("INVALID_FACTOR","Generated or transformed factor outside target parameter bounds");
                }
            }
        }
    }
    void audit_initialized() const {
        audit_parameters();
        auto& sim=parent->project->sim;
        std::set<irt::embedded_simulation_id> resources;
        for(std::size_t i=0;i<bindings.size();++i) {
            const auto& b=bindings[i];
            try { irt_web::validate_binding(sim,b,occurrences[i].plan); }
            catch(const std::exception& e) { fail("INITIALIZATION_ERROR",e.what()); }
            if(!resources.insert(b.resource).second || sim.sims.get(b.resource).embedded_sims.size()!=(occurrences[i].plan.dynamic_plan?0:b.scenarios))
                fail("INITIALIZATION_ERROR","Incorrect private resource/scenario allocation");
        }
        if(resources.size()!=sim.sims.size()) fail("INITIALIZATION_ERROR","Unreferenced wrapper resource remains");
    }
    void append_result(D& result) const {
        auto& a=result.GetAllocator();
        V list(rapidjson::kArrayType),layouts(rapidjson::kArrayType);
        for(const auto& event:events) {
            const auto it=std::find_if(bindings.begin(),bindings.end(),[&](const auto& b){return b.wrapper==event.wrapper;});
            if(it==bindings.end()) fail("EXECUTION_ERROR","Unbound event source");
            const auto& o=occurrences.at(it-bindings.begin());
            V item(rapidjson::kObjectType),value(rapidjson::kArrayType);
            for(double number:event.value) value.PushBack(number,a);
            item.AddMember("component",V(o.path.c_str(),a),a).AddMember("time",event.time,a).AddMember("port",static_cast<unsigned>(event.port),a)
                .AddMember("bag",static_cast<unsigned>(event.bag),a).AddMember("value",value,a);
            list.PushBack(item,a);
        }
        for(const auto& o:occurrences) {
            V item(rapidjson::kObjectType),outputs(rapidjson::kArrayType);
            auto add=[&](const std::string& id,const char* kind) {
                V port(rapidjson::kObjectType);
                port.AddMember("port",outputs.Size(),a).AddMember("kind",V(kind,a),a).AddMember("id",V(id.c_str(),a),a);
                outputs.PushBack(port,a);
            };
            for(const auto& s:o.plan.selections) add(s.id,"selection");
            for(const auto& f:o.plan.factors) add(f.id,"factor");
            if(o.plan.scenario_results) {
                add("scenario-status","scenario-status");
                for(const auto& f:o.plan.factors) add(f.id,"scenario-factor");
                for(const auto& s:o.plan.selections) add(s.id,"scenario-selection");
                add("campaign-end","campaign-end");
            }
            if(o.plan.dynamic_plan) add("plan-ready","plan-ready");
            item.AddMember("component",V(o.path.c_str(),a),a).AddMember("inputs",static_cast<unsigned>(o.plan.input_count()),a)
                .AddMember("outputs",outputs,a).AddMember("scenarioCount",static_cast<unsigned>(scenarios(o.plan)),a)
                .AddMember("criteriaScale",V(o.plan.method==irt::optimization_method::weighted_sum?"normalized":"raw",a),a);
            layouts.PushBack(item,a);
        }
        result["schemaVersion"].SetInt(2);
        result.AddMember("resultEvents",list,a).AddMember("wrappers",layouts,a);
        result["diagnostics"].AddMember("collectorModelCount",collector_models,a);
    }
};
