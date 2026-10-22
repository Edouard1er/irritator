#include <irritator/core.hpp>
#include <irritator/modeling.hpp>
#include "native_wrapper.hpp"
#include <memory>
#include <rapidjson/document.h>
#include <rapidjson/schema.h>
#include <rapidjson/stringbuffer.h>
#include <rapidjson/writer.h>
#include "contracts.hpp"

#include <algorithm>
#include <cmath>
#include <charconv>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>
#if defined(_MSC_VER) && defined(_DEBUG)
#include <crtdbg.h>
#endif

namespace {
using V = rapidjson::Value;
using D = rapidjson::Document;
struct failure : std::runtime_error {
    std::string code;
    int category = -1, native = -1;
    failure(std::string c, std::string m) : std::runtime_error(m), code(std::move(c)) {}
};
[[noreturn]] void fail(const char* code, const std::string& message) { throw failure(code,message); }
void check(irt::status status, const char* code, const char* operation) {
    if (status.has_error()) {
        failure f(code,operation);
        f.category = static_cast<int>(status.error().cat());
        f.native = status.error().value();
        throw f;
    }
}
std::string str(const V& v) { return {v.GetString(),v.GetStringLength()}; }
void emit(const V& value) {
    rapidjson::StringBuffer buffer;
    rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
    if (!value.Accept(writer)) fail("SERIALIZATION_ERROR","Cannot serialize finite JSON result");
    std::cout << buffer.GetString() << '\n';
}
void unique_keys(const V& v, unsigned depth=0) {
    if (depth > 32) fail("INVALID_JSON","Maximum nesting depth exceeded");
    if (v.IsObject()) {
        std::set<std::string> names;
        for (auto it=v.MemberBegin();it!=v.MemberEnd();++it) {
            if (!names.insert(str(it->name)).second) fail("INVALID_JSON","Duplicate JSON member");
            unique_keys(it->value,depth+1);
        }
    } else if (v.IsArray()) for (const auto& item:v.GetArray()) unique_keys(item,depth+1);
}
template<class T> irt::model& allocate(irt::simulation& sim) { return irt::get_model(sim.alloc<T>()); }
using constructor = irt::model& (*)(irt::simulation&);
struct atomic_type { constructor make; irt::dynamics_type dynamics; };
template<class T> constexpr atomic_type atomic() { return {allocate<T>,irt::dynamics_typeof<T>()}; }
const std::map<std::string,atomic_type> registry{
    {"constant",atomic<irt::constant>()}, {"qss1_sum_2",atomic<irt::qss1_sum_2>()},
    {"qss1_sum_3",atomic<irt::qss1_sum_3>()}, {"qss1_integrator",atomic<irt::qss1_integrator>()},
    {"qss3_integrator",atomic<irt::qss3_integrator>()}, {"qss2_integrator",atomic<irt::qss2_integrator>()},
    {"qss1_multiplier",atomic<irt::qss1_multiplier>()}, {"qss3_multiplier",atomic<irt::qss3_multiplier>()},
    {"qss3_wsum_2",atomic<irt::qss3_wsum_2>()}, {"qss3_power",atomic<irt::qss3_power>()},
    {"qss3_inverse",atomic<irt::qss3_inverse>()}, {"qss3_square",atomic<irt::qss3_square>()},
    {"qss3_sqrt",atomic<irt::qss3_sqrt>()}
};
// Flat and coupled models use exactly the same native parameter setters.
void set_parameters(irt::parameter& target,const std::string& type,const V& p) {
    if(type=="constant") target.set_constant(p["value"].GetDouble(),p["offset"].GetDouble());
    else if(type=="qss1_integrator" || type=="qss2_integrator" || type=="qss3_integrator") target.set_integrator(p["X"].GetDouble(),p["dQ"].GetDouble());
    else if(type=="qss3_wsum_2") target.set_wsum2(p["coeff-0"].GetDouble(),p["coeff-1"].GetDouble());
    else if(type=="qss3_power") target.set_power(p["n"].GetDouble());
}
const V& descriptor(const D& catalog,const std::string& type) {
    for(const auto& c:catalog["components"].GetArray()) if(str(c["type"])==type) return c;
    fail("UNKNOWN_COMPONENT","Unsupported component type: "+type);
}
int limit(const D& doc,const char* name,int cap) {
    return doc.HasMember("limits") && doc["limits"].HasMember(name) ? doc["limits"][name].GetInt() : cap;
}
void configure_debug_diagnostics() {
#ifdef IRRITATOR_ENABLE_DEBUG
    // The native Debug allocator opens irt-mem.txt, with stdout as fallback.
    // Allocation-by-allocation tracing grows with scenario copies and can
    // exhaust the HTTP stderr budget even for small valid v3 graphs. Silence
    // only this verbose trace; assertions and actual stderr errors stay active.
    // Refuse the stdout fallback before any engine allocation.
    auto* stream=irt::debug::mem_file();
    if(stream==stdout) fail("INITIALIZATION_ERROR","Cannot open Debug diagnostic stream in working directory");
#ifdef _WIN32
    const char* sink="NUL";
#else
    const char* sink="/dev/null";
#endif
    if(!std::freopen(sink,"w",stream)) fail("INITIALIZATION_ERROR","Cannot configure Debug allocation trace sink");
#endif
}
#include "hierarchy.hpp"
#include "json_wrapper.hpp"
D execute(const D& doc,const D& catalog) {
    const auto& model=doc["model"];
    const auto& components=model["components"];
    const double start=doc["simulation"]["start"].GetDouble(), end=doc["simulation"]["end"].GetDouble();
    if (!(end>start) || end-start>1e9) fail("INVALID_TIME","Expected start < end and horizon <= 1e9");
    const auto max_calls=limit(doc,"maxRunCalls",100000), max_points=limit(doc,"maxPoints",20000);
    const bool v3=doc["schemaVersion"].GetInt()==3;
    const bool hierarchical=doc["schemaVersion"].GetInt()>=2;
    if (!hierarchical) {
    if (components.Size()>unsigned(limit(doc,"maxComponents",128)) ||
        model["connections"].Size()>unsigned(limit(doc,"maxConnections",512))) fail("LIMIT_EXCEEDED","Model size budget exceeded");
    std::map<std::string,const V*> specs;
    for (const auto& c:components.GetArray()) {
        const auto id=str(c["id"]), type=str(c["type"]);
        if (!specs.emplace(id,&c).second) fail("INVALID_MODEL","Duplicate component id: "+id);
        const auto& desc=descriptor(catalog,type);
        if (!registry.contains(type)) fail("UNKNOWN_COMPONENT","Missing constructor: "+type);
        const auto& params=c["parameters"];
        for(const auto& key:desc["required"].GetArray()) if(!params.HasMember(key.GetString())) fail("INVALID_PARAMETER","Missing parameter: "+str(key));
        for(auto p=params.MemberBegin();p!=params.MemberEnd();++p) {
            if(!desc["parameters"].HasMember(p->name)) fail("INVALID_PARAMETER","Unknown parameter: "+str(p->name));
            const auto& bounds=desc["parameters"][p->name];
            double value=p->value.GetDouble();
            if(!std::isfinite(value) || value<bounds["minimum"].GetDouble() || value>bounds["maximum"].GetDouble()) fail("INVALID_PARAMETER","Parameter out of bounds: "+str(p->name));
        }
    }
    auto find=[&](const V& id)->const V& {
        auto it=specs.find(str(id));
        if(it==specs.end()) fail("INVALID_REFERENCE","Unknown component: "+str(id));
        return *it->second;
    };
    std::set<std::string> edges, observed;
    for(const auto& edge:model["connections"].GetArray()) {
        const auto& from=edge["from"]; const auto& to=edge["to"];
        const auto& a=descriptor(catalog,str(find(from["component"])["type"]));
        const auto& b=descriptor(catalog,str(find(to["component"])["type"]));
        if(from["port"].GetUint()>=a["outputs"].Size() || to["port"].GetUint()>=b["inputs"].Size()) fail("INVALID_CONNECTION","Invalid port number or direction");
        const auto key=str(from["component"])+":"+std::to_string(from["port"].GetInt())+">"+str(to["component"])+":"+std::to_string(to["port"].GetInt());
        if(!edges.insert(key).second) fail("INVALID_CONNECTION","Duplicate connection");
    }
    double estimated=0;
    for(const auto& o:model["observations"].GetArray()) {
        find(o["component"]);
        if(!observed.insert(str(o["component"])).second) fail("OBSERVATION_ERROR","Duplicate observation");
        const auto dt=o["samplingInterval"].GetDouble();
        if(!(start+dt>start) || !(end+dt>end)) fail("OBSERVATION_ERROR","Sampling interval cannot advance floating point time");
        estimated+=std::ceil((end-start)/dt)+2;
        if(estimated>max_points) fail("LIMIT_EXCEEDED","Potential sampling grid exceeds maxPoints (including terminal margin)");
    }

    }
    std::unique_ptr<native_hierarchy> hierarchy;
    std::unique_ptr<json_wrappers> wrappers;
    if(v3) wrappers=std::make_unique<json_wrappers>(doc,catalog);
    else if(hierarchical) hierarchy=std::make_unique<native_hierarchy>(doc,catalog);
    configure_debug_diagnostics();
    std::unique_ptr<irt::simulation> flat;
    if(wrappers) wrappers->build();
    else if(hierarchy) hierarchy->build(); else flat=std::make_unique<irt::simulation>();
    auto* graph=wrappers?wrappers->parent.get():hierarchy.get();
    auto& sim=graph?graph->project->sim:*flat;
    if(!graph && (!sim.can_alloc(components.Size()) || !sim.can_connect(model["connections"].Size()))) fail("LIMIT_EXCEEDED","Engine capacity unavailable");
    std::map<std::string,irt::model_id> ids;
    if(graph) ids=graph->models;
    else {
    for(const auto& c:components.GetArray()) {
        const auto type=str(c["type"]);
        auto& native=registry.at(type).make(sim);
        const auto id=sim.get_id(native);
        ids.emplace(str(c["id"]),id);
        set_parameters(sim.parameters[id],type,c["parameters"]);
    }
    for(const auto& e:model["connections"].GetArray())
        check(sim.connect(sim.models.get(ids.at(str(e["from"]["component"]))),e["from"]["port"].GetInt(),
                          sim.models.get(ids.at(str(e["to"]["component"]))),e["to"]["port"].GetInt()),"INVALID_CONNECTION","simulation.connect");
    }
    sim.limits.set_bound(start,end);
    std::vector<irt::observer_id> observers;
    for(const auto& o:model["observations"].GetArray()) {
        auto& m=sim.models.get(ids.at(str(o["component"])));
        check(sim.observe(m,o["samplingInterval"].GetDouble()),"OBSERVATION_ERROR","simulation.observe");
        observers.push_back(m.obs_id);
    }
    if(wrappers) check(sim.srcs.prepare(),"INITIALIZATION_ERROR","simulation.srcs.prepare");
    check(sim.initialize(),"INITIALIZATION_ERROR","simulation.initialize");
    if(wrappers) wrappers->audit_initialized();
    unsigned calls=0;
    try {
        while(!sim.current_time_expired()) {
            if(calls>=unsigned(max_calls)) fail("LIMIT_EXCEEDED","Scheduler call budget exceeded");
            ++calls;
            check(sim.run(),"EXECUTION_ERROR","simulation.run");
            if(wrappers) wrappers->collect(calls);
            sim.tick_resamplers();
        }
    } catch(...) {
        const auto cleanup=sim.finalize();
        if(cleanup.has_error()) std::cerr << "finalize failed during error cleanup\n";
        throw;
    }
    check(sim.finalize(),"EXECUTION_ERROR","simulation.finalize");
    sim.tick_resamplers();
    for(auto id:observers) sim.observers.get<irt::resampler>(id).tick(*sim.observers.try_to_get(id),std::numeric_limits<double>::infinity());

    D result(rapidjson::kObjectType); auto& a=result.GetAllocator();
    result.AddMember("schemaVersion",1,a).AddMember("status","completed",a);
    result.AddMember("modelId",V(model["id"],a),a);
    V timing(rapidjson::kObjectType);
    const double final_time=sim.current_time();
    if(!std::isfinite(final_time) || final_time!=end) fail("EXECUTION_ERROR","Unexpected final time");
    timing.AddMember("start",start,a).AddMember("end",end,a).AddMember("finalTime",final_time,a).AddMember("runCalls",calls,a);
    result.AddMember("simulation",timing,a);
    V observations(rapidjson::kArrayType);
    std::size_t total=0, index=0;
    for(const auto& o:model["observations"].GetArray()) {
        V output(rapidjson::kObjectType), samples(rapidjson::kArrayType);
        output.AddMember("component",V(o["component"],a),a).AddMember("samplingInterval",o["samplingInterval"].GetDouble(),a);
        sim.observers.try_to_get(observers.at(index++))->read_history([&](const auto& history,const auto) {
            double previous=-std::numeric_limits<double>::infinity();
            for(const auto& s:history) {
                if(++total>unsigned(max_points)) fail("LIMIT_EXCEEDED","Output point budget exceeded");
                if(!std::isfinite(s.t) || !std::isfinite(s.value) || s.t<start || s.t>end || s.t<=previous) fail("OBSERVATION_ERROR","Non-finite or unordered history");
                previous=s.t;
                V point(rapidjson::kObjectType);
                point.AddMember("time",s.t,a).AddMember("value",s.value,a);
                samples.PushBack(point,a);
            }
        });
        if(samples.Empty()) fail("OBSERVATION_ERROR","No published samples for requested component");
        output.AddMember("samples",samples,a); observations.PushBack(output,a);
    }
    result.AddMember("observations",observations,a);
    V diagnostics(rapidjson::kObjectType);
    diagnostics.AddMember("observationPolicy","engine-resampled-sealed-deduplicated",a).AddMember("engineVersion","0.1.0",a).AddMember("adapterVersion","0.1.0",a);
    if(graph) diagnostics.AddMember("nativeModelCount",static_cast<unsigned>(graph->models.size()),a).AddMember("distinctNativeModelIds",true,a);
    result.AddMember("diagnostics",diagnostics,a);
    if(wrappers) wrappers->append_result(result);
    return result;
}
}
int main(int argc,char** argv) {
#ifdef _MSC_VER
    // This executable is an unattended child process. A native abort must
    // terminate it, never wait for a CRT dialog or Windows fault reporting.
    (void)_set_error_mode(_OUT_TO_STDERR);
    _set_abort_behavior(0,_WRITE_ABORT_MSG | _CALL_REPORTFAULT);
#ifdef _DEBUG
    _CrtSetReportMode(_CRT_ASSERT, _CRTDBG_MODE_FILE);
    _CrtSetReportFile(_CRT_ASSERT, _CRTDBG_FILE_STDERR);
#endif
#endif
    try {
        D catalog; catalog.Parse(catalog_json);
        if(argc==2 && std::string(argv[1])=="--describe") { emit(catalog); return 0; }
        if(argc==2 && std::string(argv[1])=="--capabilities") {
            rapidjson::Document capabilities;
            capabilities.Parse(runner_capabilities_json);
            emit(capabilities); return 0;
        }
        if(argc!=1) fail("INVALID_ARGUMENT","Only --describe and --capabilities are supported");
        std::string input; char buffer[4096];
        while(std::cin.read(buffer,sizeof buffer) || std::cin.gcount()) {
            input.append(buffer,static_cast<std::size_t>(std::cin.gcount()));
            if(input.size()>1048576) fail("LIMIT_EXCEEDED","stdin exceeds 1 MiB");
        }
        if(input.find('\0')!=std::string::npos) fail("INVALID_JSON","NUL byte in JSON document");
        D doc; doc.Parse<rapidjson::kParseValidateEncodingFlag | rapidjson::kParseIterativeFlag>(input.data(),input.size());
        if(doc.HasParseError()) fail("INVALID_JSON","Invalid JSON document at byte "+std::to_string(doc.GetErrorOffset()));
        unique_keys(doc);
        const int version=doc.IsObject() && doc.HasMember("schemaVersion") && doc["schemaVersion"].IsInt()?doc["schemaVersion"].GetInt():1;
        D schema; schema.Parse(version==3?request_v3_schema_json:version==2?request_v2_schema_json:request_schema_json);
        rapidjson::SchemaDocument compiled(schema);
        rapidjson::SchemaValidator validator(compiled);
        if(!doc.Accept(validator)) {
            rapidjson::StringBuffer path; validator.GetInvalidDocumentPointer().StringifyUriFragment(path);
            fail("INVALID_MODEL",std::string("Schema violation at ")+path.GetString()+" ("+validator.GetInvalidSchemaKeyword()+")");
        }
        emit(execute(doc,catalog));
        return 0;
    } catch(const failure& f) {
        D result(rapidjson::kObjectType); auto& a=result.GetAllocator();
        V error(rapidjson::kObjectType);
        error.AddMember("code",V(f.code.c_str(),a),a).AddMember("message",V(f.what(),a),a);
        if(f.category>=0) { error.AddMember("engineCategory",f.category,a); error.AddMember("engineCode",f.native,a); }
        result.AddMember("schemaVersion",1,a).AddMember("status","failed",a).AddMember("error",error,a);
        emit(result); std::cerr << f.code << ": " << f.what() << '\n'; return 2;
    } catch(const std::exception& e) {
        std::cerr << "INTERNAL_ERROR: " << e.what() << '\n';
        std::cout << "{\"schemaVersion\":1,\"status\":\"failed\",\"error\":{\"code\":\"INTERNAL_ERROR\",\"message\":\"Runner internal failure\"}}\n";
        return 3;
    }
}
